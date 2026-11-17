import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ReleaseUpdateNotice from '../../src/components/ReleaseUpdateNotice';
import '../../src/index.css';
const p = new URLSearchParams(location.search);
createRoot(document.getElementById('root')).render(<MemoryRouter><div className="p-4"><ReleaseUpdateNotice role={p.get('role')} gradeScope={p.get('grade')} /></div></MemoryRouter>);
