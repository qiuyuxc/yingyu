import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, ThemeProvider, ToastProvider } from './context';
import { App } from './App';
import './styles.css';
import './styles/pages.css';
import './styles/responsive.css';
import './styles/themes.css';
import './styles/motion.css';
import './styles/account-media.css';
import './styles/navigation.css';

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><ThemeProvider><ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider></ThemeProvider></BrowserRouter></StrictMode>);
