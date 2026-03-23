import { HashRouter, Routes, Route } from 'react-router-dom';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { PlatformPage } from './pages/PlatformPage';
import { PSNPage } from './pages/PSNPage';

import { Settings } from './pages/Settings';
import { Jobs } from './pages/Jobs';
import { JobManager } from './components/JobManager';
import { PSNPresenceManager } from './components/PSNPresenceManager';
import { ToastContainer } from './components/Toast';

function App() {
    return (
        <HashRouter>
            <JobManager />
            <PSNPresenceManager />
            <ToastContainer />
            <div className="flex flex-col h-screen overflow-hidden">
                {/* Custom Window Title Bar */}
                <TitleBar />

                {/* Main Content Area */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar Navigation */}
                    <Sidebar />

                    {/* Page Content */}
                    <main className="flex-1 overflow-y-auto p-6">
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/platform/psn" element={<PSNPage />} />
                            <Route path="/platform/:platformId" element={<PlatformPage />} />
                            <Route path="/jobs" element={<Jobs />} />
                            <Route path="/settings" element={<Settings />} />
                        </Routes>
                    </main>
                </div>
            </div>
        </HashRouter>
    );
}

export default App;
