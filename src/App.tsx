import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, CheckCircle, Apple, Smartphone, Info, RefreshCw, PlusCircle, Settings } from 'lucide-react';
import { cn } from './lib/utils';

// Types
interface AppModel {
  id: number;
  name: string;
  bundle_id: string;
  version: string;
  icon: string | null;
}

// UI Components
const AppCard = ({ app, onClick }: { app: AppModel, onClick: (app: AppModel) => void }) => (
  <div onClick={() => onClick(app)} className="glass-card group cursor-pointer">
    <div className="flex items-start gap-4 mb-4">
      <div className="w-16 h-16 rounded-2xl bg-zinc-800 shadow-lg flex-shrink-0 overflow-hidden flex items-center justify-center border border-zinc-700/50">
        {app.icon ? (
          <img src={app.icon} alt={app.name} className="w-full h-full object-cover" />
        ) : (
          <Apple size={28} className="text-zinc-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-base text-zinc-100 truncate">{app.name}</h3>
        <p className="text-xs text-zinc-500 truncate">v{app.version} • {app.bundle_id}</p>
      </div>
    </div>
    <button className="w-full py-2.5 bg-zinc-800 hover:bg-blue-600 rounded-xl text-sm font-semibold transition-all">Install Now</button>
  </div>
);

export default function App() {
  const [currentRoute, setCurrentRoute] = useState<'home' | 'app' | 'register' | 'admin'>('home');
  const [selectedApp, setSelectedApp] = useState<AppModel | null>(null);
  const [apps, setApps] = useState<AppModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [udid, setUdid] = useState(localStorage.getItem('udid') || '');

  useEffect(() => {
    fetchApps();
    // Demo seed
    setTimeout(() => {
      if (apps.length === 0) seedDemoApps();
    }, 2000);
  }, []);

  const fetchApps = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/apps');
      const data = await res.json();
      setApps(data || []);
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  const seedDemoApps = async () => {
    await fetch('/api/admin/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Retro Game Emulator',
        bundle_id: 'com.emulator.retro',
        version: '1.4.2',
        icon: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=128&h=128&fit=crop',
      })
    });
    fetchApps();
  };

  const navigateToApp = (app: AppModel) => {
    setSelectedApp(app);
    setCurrentRoute('app');
  };

  const HomeView = () => (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold mb-1 text-zinc-100">App Repository</h1>
          <p className="text-sm text-zinc-500">Select an application to sign and install via itms-services.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <input type="text" placeholder="Search apps..." className="bg-zinc-900 border border-zinc-800 rounded-lg py-2 px-4 pl-10 text-sm focus:outline-none focus:border-blue-500 w-full sm:w-64 text-zinc-200"/>
            <svg className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>
        </div>
      </div>
      
      {isLoading ? (
        <div className="text-center text-zinc-500 py-12">Loading apps...</div>
      ) : apps.length === 0 ? (
        <div className="text-center text-zinc-500 py-12">No apps available yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {apps.map(app => (
            <div key={app.id}>
              <AppCard app={app} onClick={navigateToApp} />
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );

  const AppDetailView = () => {
    const [installState, setInstallState] = useState<'idle' | 'checking' | 'signing' | 'ready'>('idle');
    const [error, setError] = useState('');

    const handleInstall = async () => {
      if (!selectedApp) return;
      if (!udid) {
        setCurrentRoute('register');
        return;
      }

      setInstallState('checking');
      // check device registration
      try {
        const check = await fetch(`/api/device/${udid}`);
        const result = await check.json();
        
        if (!result.registered) {
          setCurrentRoute('register');
          return;
        }

        setInstallState('signing');
        const installRes = await fetch(`/api/install/${selectedApp.id}/${udid}`, { method: 'POST' });
        const installData = await installRes.json();
        
        if (installData.success) {
          setInstallState('ready');
          setTimeout(() => {
            window.location.href = installData.installLink;
          }, 1500);
        } else {
          setError(installData.error || 'Failed to generate install link');
          setInstallState('idle');
        }

      } catch (err) {
        setError('Connection error');
        setInstallState('idle');
      }
    };

    return (
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
        <button onClick={() => setCurrentRoute('home')} className="text-blue-500 font-medium mb-6 flex items-center">
          â Back
        </button>
        
        {selectedApp && (
          <div className="flex flex-col items-center text-center mt-6">
            <div className="w-32 h-32 rounded-[32px] bg-slate-800 shadow-2xl mb-6 overflow-hidden outline outline-1 outline-white/10">
              {selectedApp.icon ? (
                <img src={selectedApp.icon} alt={selectedApp.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-500">
                  <Apple size={48} />
                </div>
              )}
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">{selectedApp.name}</h1>
            <p className="text-gray-400 mb-8 font-medium">Version {selectedApp.version}</p>

            <div className="w-full max-w-sm">
              <button 
                onClick={handleInstall}
                disabled={installState !== 'idle'}
                className={cn("w-full btn-primary py-4 text-lg font-semibold flex items-center justify-center space-x-2", 
                  installState !== 'idle' && "opacity-80 cursor-wait bg-blue-700")}
              >
                {installState === 'idle' && <><Download size={20} /> <span>Install Application</span></>}
                {installState === 'checking' && <><RefreshCw size={20} className="animate-spin" /> <span>Checking Device...</span></>}
                {installState === 'signing' && <><RefreshCw size={20} className="animate-spin" /> <span>Signing IPA...</span></>}
                {installState === 'ready' && <><CheckCircle size={20} /> <span>Redirecting to iOS...</span></>}
              </button>
              
              {error && <div className="mt-4 text-red-400 text-sm">{error}</div>}

              <div className="mt-8 text-left glass-card p-5">
                <div className="flex items-start space-x-3 text-sm text-gray-300">
                  <Info size={20} className="text-blue-400 flex-shrink-0 mt-0.5" />
                  <p>After clicking Install, you may see a prompt. Click "Install". Ensure your device is registered with this service.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    );
  };

  const RegisterView = () => {
    const [inputUdid, setInputUdid] = useState('');
    
    const handleManualRegister = async () => {
      if(inputUdid.length < 24) return;
      try {
        const res = await fetch('/api/enroll/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ udid: inputUdid, device_name: 'Manual Web Device' })
        });
        const data = await res.json();
        if(data.success) {
          localStorage.setItem('udid', inputUdid);
          setUdid(inputUdid);
          setCurrentRoute('app'); // go back to app
        }
      } catch (err) { }
    };

    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-10">
        <div className="w-20 h-20 bg-blue-600/20 text-blue-500 rounded-full flex items-center justify-center mb-6">
          <Smartphone size={36} />
        </div>
        <h2 className="text-2xl font-bold mb-3 text-center">Unregistered Device</h2>
        <p className="text-gray-400 text-center mb-8 max-w-sm">
          To install private apps, we need to register your device with our Apple Developer account.
        </p>

        <a href="/api/enroll" className="btn-primary w-full max-w-sm flex items-center justify-center mb-8">
          Download Profile
        </a>

        <div className="w-full max-w-sm glass-card p-5">
          <h3 className="font-medium mb-2 text-zinc-200">Instructions</h3>
          <ol className="text-sm text-zinc-400 space-y-2 list-decimal list-inside">
            <li>Download the profile above.</li>
            <li>Go to <strong>Settings</strong> → <strong>Profile Downloaded</strong>.</li>
            <li>Tap <strong>Install</strong> and follow prompts.</li>
            <li>Return here to continue downloading.</li>
          </ol>
          <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400">
            <strong>Note:</strong> You will see a "Not Signed" warning. This is expected. Please tap "Install" to proceed safely.
          </div>
        </div>
        
        <div className="w-full max-w-sm mt-8 border-t border-white/10 pt-8">
          <p className="text-sm text-gray-500 mb-3">Or enter UDID manually for testing:</p>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={inputUdid} 
              onChange={e => setInputUdid(e.target.value)}
              placeholder="e.g. 00008110-00A..." 
              className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 flex-grow text-sm focus:outline-none focus:border-blue-500"
            />
            <button onClick={handleManualRegister} className="bg-white/10 hover:bg-white/20 px-4 rounded-lg text-sm font-medium transition">Save</button>
          </div>
        </div>
        
        <button onClick={() => setCurrentRoute('home')} className="mt-8 text-sm text-gray-500 hover:text-white">Cancel</button>
      </motion.div>
    );
  };

  const AdminView = () => {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <button onClick={() => setCurrentRoute('home')} className="text-blue-500 font-medium mb-6 flex items-center">
          â Back
        </button>
        <h2 className="text-2xl font-bold mb-6">Admin Area</h2>
        <div className="glass-card p-6">
          <p className="text-gray-400 text-sm mb-4">In a real scenario, this form would upload an actual IPA file using multipart/form-data. We seed a demo instead.</p>
          <button onClick={seedDemoApps} className="btn-secondary w-full flex items-center justify-center gap-2">
            <PlusCircle size={18} /> Add Demo App
          </button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="bg-zinc-950 text-zinc-50 w-full h-screen flex flex-col font-sans select-none">
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-4 sm:px-8 bg-zinc-950/50 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentRoute('home')}>
          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          </div>
          <span className="text-lg font-semibold tracking-tight hidden sm:block">NextLevel <span className="text-zinc-400">IPA</span></span>
        </div>
        <div className="flex items-center gap-4 sm:gap-6">
          {udid ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full truncate">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse flex-shrink-0"></div>
              <span className="text-xs font-medium text-zinc-400 truncate hidden sm:inline-block">UDID Linked: {udid.substring(0, 14)}...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full cursor-pointer hover:bg-zinc-800 transition" onClick={() => setCurrentRoute('register')}>
              <div className="w-2 h-2 bg-rose-500 rounded-full flex-shrink-0"></div>
              <span className="text-xs font-medium text-zinc-400 hidden sm:inline-block">Device Unregistered</span>
            </div>
          )}
          <button className="text-sm text-zinc-400 hover:text-white" onClick={() => setCurrentRoute('admin')}>Admin</button>
        </div>
      </header>
      
      <main className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r border-zinc-800 bg-zinc-950 p-6 flex-col gap-8 hidden md:flex shrink-0">
          <nav className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-4">Library</div>
            <a href="#" onClick={(e) => { e.preventDefault(); setCurrentRoute('home'); }} className={cn("flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors", currentRoute === 'home' ? "bg-blue-600/10 text-blue-400" : "text-zinc-400 hover:bg-zinc-900")}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
              All Applications
            </a>
            <a href="#" className="flex items-center gap-3 px-3 py-2 text-zinc-400 hover:bg-zinc-900 rounded-lg text-sm font-medium transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Recent Installs
            </a>
          </nav>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-4">Categories</div>
            <div className="space-y-1 text-sm text-zinc-400">
              <div className="px-3 py-2 hover:text-white cursor-pointer transition-colors">Social Media</div>
              <div className="px-3 py-2 hover:text-white cursor-pointer transition-colors">Emulators</div>
              <div className="px-3 py-2 hover:text-white cursor-pointer transition-colors">Developer Tools</div>
              <div className="px-3 py-2 hover:text-white cursor-pointer transition-colors">Tweaked Games</div>
            </div>
          </div>
          <div className="mt-auto p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
            <div className="text-xs font-semibold text-zinc-300 mb-1">Device Status</div>
            <p className="text-[11px] text-zinc-500 leading-relaxed mb-3">Device connected. Ready for signing.</p>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full w-full bg-emerald-500/50"></div>
            </div>
          </div>
        </aside>
        
        <section className="flex-1 p-4 sm:p-8 bg-zinc-950 overflow-y-auto w-full">
          <div className="max-w-5xl mx-auto pb-20">
            <AnimatePresence mode="wait">
              {currentRoute === 'home' && <HomeView key="home" />}
              {currentRoute === 'app' && <AppDetailView key="app" />}
              {currentRoute === 'register' && <RegisterView key="register" />}
              {currentRoute === 'admin' && <AdminView key="admin" />}
            </AnimatePresence>
          </div>
        </section>
      </main>
    </div>
  );
}

