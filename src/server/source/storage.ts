import { lstat, readdir, statfs, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Store } from '../store';

const MiB = 1024 * 1024;
export const sourceStorageLimits = { databaseBytes: 2048 * MiB, freeBytes: 256 * MiB, resultReserveBytes: 256 * MiB, spoolReserveBytes: 48 * MiB };
export type StorageMeasurement = { databaseBytes: number; journalBytes: number; free: { location: 'database' | 'input' | 'output'; bytes: number }[] };
export type StorageStatus = StorageMeasurement & { allowed: boolean; reason: string | null; retention: 'preserve-all-evidence' };
export class SourceStoragePressure extends Error {
  constructor(public reason: string) { super(reason); }
}
/** Reserve the next result and journal growth before accepting work. Never reclaim historical evidence. */
export function storageAdmission(measured: StorageMeasurement, limits = sourceStorageLimits): StorageStatus {
  let reason: string | null = null;
  if (measured.databaseBytes + measured.journalBytes + limits.resultReserveBytes * 2 >= limits.databaseBytes)
    reason = 'Source scanning paused: database storage budget reached. Historical evidence is retained.';
  else if (measured.free.some(f => f.bytes < limits.freeBytes + (f.location === 'database' ? limits.resultReserveBytes * 2 : limits.spoolReserveBytes)))
    reason = 'Source scanning paused: insufficient free storage. Historical evidence is retained.';
  return { ...measured, allowed: reason === null, reason, retention: 'preserve-all-evidence' };
}
export async function sourceStorageStatus(store: Store, spool: string, limits = sourceStorageLimits): Promise<StorageStatus> {
  const file = String(store.db.prepare('PRAGMA database_list').all().find(r => r.name === 'main')?.file ?? '');
  const databaseBytes = Number(store.db.prepare('PRAGMA page_count').get()!.page_count) * Number(store.db.prepare('PRAGMA page_size').get()!.page_size);
  const size = async (path: string) => { try { const value=await lstat(path); if(!value.isFile())throw new Error('Unexpected storage file.');return value.size; } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return 0;throw e; } };
  const journalBytes = file ? await size(file+'-wal') + await size(file+'-shm') : 0;
  const locations: { location: 'database' | 'input' | 'output'; path: string }[] = [
    { location: 'input', path: join(spool,'in') }, { location: 'output', path: join(spool,'out') },
    ...(file ? [{location:'database' as const,path:dirname(file)}] : []),
  ];
  const free = await Promise.all(locations.map(async ({location,path})=>{const disk=await statfs(path);return {location,bytes:Number(disk.bavail)*Number(disk.bsize)};}));
  return storageAdmission({ databaseBytes, journalBytes, free }, limits);
}
export async function requireSourceStorage(store: Store, spool: string, limits = sourceStorageLimits) {
  try { const status=await sourceStorageStatus(store,spool,limits);if(!status.allowed)throw new SourceStoragePressure(status.reason!);return status; }
  catch(e) { if(e instanceof SourceStoragePressure)throw e;throw new SourceStoragePressure('Source scanning paused: storage availability could not be checked. Historical evidence is retained.'); }
}
const transientName = /^[a-f0-9-]{36}\.json(?:\.tmp)?$/;
/** Single scanner owns the spool. Startup cancels forgotten attempts; periodic sweeps remove only aged scratch transport files. */
export async function cleanSourceSpool(spool: string, recovery = false, now = Date.now()) {
  const removed = { input: 0, output: 0 };
  for (const [part,key] of [['in','input'],['out','output']] as const) {
    let names: string[];
    try { names=await readdir(join(spool,part)); } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e; }
    for (const name of names) {
      if(!transientName.test(name))continue;
      const path=join(spool,part,name);
      try {
        const info=await lstat(path); if(!info.isFile() || (!recovery && now-info.mtimeMs<10*60_000))continue;
        // Only the worker can release a live claim. Deleting its input requests cancellation.
        if(part==='out') { try { await lstat(join(spool,'out',name.slice(0,36)+'.active'));continue; } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; } }
        await unlink(path);removed[key]++;
      } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; }
    }
  }
  return removed;
}

export function recordStorageError(store: Store, error: string) {
  // A completely full database may reject even the status write; it must not stop legacy scanning.
  try { if(store.getMeta('source.storage.error')!==error)store.setMeta('source.storage.error',error); } catch { /* Existing evidence stays readable; retry admission on the next turn. */ }
}
