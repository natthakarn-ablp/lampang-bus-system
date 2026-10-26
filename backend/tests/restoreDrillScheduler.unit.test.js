'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const {spawnSync}=require('child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const script=path.resolve(__dirname,'../../scripts/restore-drill-db.sh');
const posix=p=>p.replace(/\\/g,'/');
let base,dump,envfile,stub,marker;
beforeEach(()=>{
  base=fs.mkdtempSync(path.join(os.tmpdir(),'restore-scheduler-'));
  dump=path.join(base,'fixture.sql.gz');envfile=path.join(base,'fixture.env');stub=path.join(base,'mysql');marker=path.join(base,'drop-attempt');
  fs.writeFileSync(dump,zlib.gzipSync('-- MySQL dump synthetic fixture\n'));
  fs.writeFileSync(dump+'.sha256',crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex')+'  fixture.sql.gz\n');
  fs.writeFileSync(envfile,'DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=lampang_bus\nDB_USER=synthetic\nDB_PASSWORD=synthetic-local-only\n');
  fs.writeFileSync(stub,'#!/usr/bin/env bash\ncase "$*" in\n *event_scheduler*) echo "$SYNTH_SCHEDULER";;\n *information_schema.events*) echo "$SYNTH_EVENTS";;\n *"DROP DATABASE"*) printf attempted > "$SYNTH_MARKER"; exit 3;;\n *) exit 2;;\nesac\n');
  fs.chmodSync(stub,0o755);
});
afterEach(()=>fs.rmSync(base,{recursive:true,force:true}));
function run(scheduler,events,target='lampang_bus_restore_drill'){
  return spawnSync(bash,[posix(script),posix(dump)],{encoding:'utf8',timeout:10000,env:{...process.env,LANG:'C.UTF-8',ENV_FILE:posix(envfile),RESTORE_MYSQL:posix(stub),RESTORE_DB:target,SYNTH_SCHEDULER:scheduler,SYNTH_EVENTS:events,SYNTH_MARKER:posix(marker)}});
}
test('enabled source events with running scheduler refuse before DROP',()=>{
  const r=run('ON','1');expect(r.status).toBe(2);expect(r.stderr).toContain('isolated MySQL instance');expect(fs.existsSync(marker)).toBe(false);
});
test('invalid metadata count refuses before DROP',()=>{
  expect(run('ON','unknown').status).toBe(2);expect(fs.existsSync(marker)).toBe(false);
});
test.each([['OFF','1'],['ON','0']])('safe scheduler/event state %s/%s reaches the isolated target step',(scheduler,events)=>{
  run(scheduler,events);expect(fs.existsSync(marker)).toBe(true);
});
test('unsafe database identifier refuses before any database action',()=>{
  expect(run('OFF','0','scratch;DROP DATABASE lampang_bus').status).toBe(2);expect(fs.existsSync(marker)).toBe(false);
});
