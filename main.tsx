import {createRoot} from 'react-dom/client';
import Page from './app/page';
import {lazy,Suspense} from 'react';
import './app/globals.css';
const Classroom=lazy(()=>import('./app/classroom/page'));
const classroom=new URLSearchParams(location.search).get('space')==='classroom';
if(classroom)document.title='揭东一中 2024 届｜高二教室数字空间';
createRoot(document.getElementById('root')!).render(classroom?<Suspense fallback={<div className="loading">正在打开高二教室…</div>}><Classroom/></Suspense>:<Page/>);
