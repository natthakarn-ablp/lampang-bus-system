import React from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../../src/components/ErrorBoundary';
import '../../src/index.css';
function Fault() { throw new Error(new URLSearchParams(location.search).get('kind') === 'asset' ? 'Failed to fetch dynamically imported module: /assets/synthetic-old.js' : 'Synthetic unexpected failure'); }
createRoot(document.getElementById('root')).render(<ErrorBoundary><Fault /></ErrorBoundary>);
