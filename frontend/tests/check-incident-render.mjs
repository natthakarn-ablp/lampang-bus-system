import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const server = await createServer({ root:fileURLToPath(new URL('..',import.meta.url)), configFile:false, plugins:[react()], server:{ middlewareMode:true, hmr:false, watch:null }, appType:'custom' });
try {
 const { default: Cards } = await server.ssrLoadModule('/src/pages/transport/IncidentPassengerCards.jsx');
 const name='เด็กหญิงชื่อจำลองยาวสำหรับตรวจการแสดงชื่อเต็ม';
 const school='โรงเรียนจำลองชื่อยาวสำหรับตรวจการแสดงโรงเรียนครบถ้วน';
 const row={id:1,name,school_name:school,pickup_points:['จุดรับจำลอง'],updated_at:'2026-10-21T00:00:00Z',parent_phone:'PRIVATE_SENTINEL',cid_hash:'PRIVATE_SENTINEL'};
 const roster=renderToStaticMarkup(React.createElement(Cards,{rows:[row]}));
 assert.ok(roster.includes(name));assert.ok(roster.includes(school));assert.ok(!roster.includes('PRIVATE_SENTINEL'));assert.ok(!roster.includes('truncate'));
 const events=renderToStaticMarkup(React.createElement(Cards,{events:true,rows:[{...row,name:'<script>test</script>',status:'CANCELLED',checked_at:'2026-10-21T00:00:00Z'}]}));
 assert.ok(events.includes('&lt;script&gt;'));assert.ok(!events.includes('<script>'));assert.ok(events.includes('ยกเลิกรายการของนักเรียนนี้'));assert.ok(events.includes('เวลาบันทึก'));
 console.log('actual_component_SSR_names_school_wrap_minimization_escape_cancellation_PASS');
} finally { await server.close(); }
