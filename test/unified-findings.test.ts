import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedFindings } from '../src/lib/unified-findings';
import type { SourceEvidence } from '../src/lib/finding-evidence';
import type { Finding, Report } from '../src/lib/model';
const f: Finding = { id:'CVE-2026-12345',package:'dep',installed:'1.0.0',fixed:'2.0.0',title:'Example',severity:'HIGH',type:'node-pkg',path:'/app/a' };
const report: Report = {findings:[f,{...f,path:'/app/b'}],packages:[],os:'',eol:false};
const source = {finding:{...f,type:'npm',path:'package-lock.json'},aliases:[f.id,'GHSA-example'],runtime:[{targetId:'image',matched:true}]} as SourceEvidence;
test('merges exact matches and duplicate paths while preserving occurrences and source-only rows',()=>{
  const only = {...source,finding:{...source.finding,package:'source-only'},aliases:['CVE-2026-12346']};
  const rows=unifiedFindings(report,[source,only],'image');
  assert.equal(rows.length,2);
  assert.equal(rows[0].finding.detection,'both');
  assert.deepEqual(rows[0].runtimeIndices,[0,1]);
  assert.deepEqual(rows[0].sources,[source]);
  assert.equal(rows[1].sourceOnly,true);
  assert.equal(rows[1].finding.detection,'codebase');
});
test('normalizes JavaScript ecosystems and advisory aliases, but never merges different versions or ecosystems',()=>{
  const rows=unifiedFindings({...report,findings:[{...f,id:'GHSA-example'}, {...f,installed:'1.1.0'}, {...f,type:'deb'}]},[source],'image');
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(r=>r.finding.detection),['both','container','container']);
});
test('source findings survive missing runtime scans and collapse duplicate manifests',()=>{
  const rows=unifiedFindings(null,[source,{...source,file:'other/package-lock.json'}],'image');
  assert.equal(rows.length,1); assert.equal(rows[0].sources.length,2);
  assert.equal(rows[0].finding.detection,'codebase');
});
test('release metadata and out-of-scope source evidence never imply both',()=>{
  assert.equal(unifiedFindings({...report,coverage:'release-source'},[source],'image').length,2);
  assert.equal(unifiedFindings(report,[],'image')[0].finding.detection,'container');
  assert.equal(unifiedFindings(report,[source],'other-image').length,2);
});
