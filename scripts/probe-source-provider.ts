import { writeFile } from 'node:fs/promises';
import { GitProvider, providerReader } from '../src/server/source/provider';
const provider = process.argv[2] === 'gitlab' ? 'gitlab' : 'github';
const locator = process.argv[3] ?? (provider === 'github' ? 'sindresorhus/is' : 'gitlab-org/gitlab');
const client = new GitProvider({ provider, origin: provider === 'github' ? 'https://api.github.com' : 'https://gitlab.com', token: '' },providerReader({gitlabOrigins:[]}));
const repo = await client.repository(locator), sha = await client.head(repo,repo.branch);
// GitLab's main repository exceeds the bounded tree collector. Identity/head reads still validate the actual adapter.
const bundle = process.argv.includes('--bundle') ? await client.bundle(repo,sha) : undefined;
console.log(JSON.stringify({observedAt:new Date().toISOString(),provider,repository:repo.name,providerId:repo.providerId,commit:sha,authentication:'none',...(bundle&&{inputPaths:Object.keys(bundle.files),bundleHash:bundle.hash}),privateAccessValidated:false,selfHostedValidated:false},null,2));

const destination=process.argv.find(a=>a.startsWith('--save='))?.slice(7);
if(destination&&bundle)await writeFile(destination,JSON.stringify(bundle),{mode:0o600});
