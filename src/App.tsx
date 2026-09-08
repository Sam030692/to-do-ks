import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Bell, Check, ChevronDown, Clock3, LogOut, Mail, MoreHorizontal, Pencil, Plus, Settings, Trash2, X } from 'lucide-react'
import { getUser, handleAuthCallback, logout, oauthLogin, onAuthChange } from '@netlify/identity'

type User = { id: string; email: string; name?: string | null }
type Priority = 'high' | 'medium' | 'low'
type Task = {
  id: number
  task_date: string
  task_name: string
  details: string
  priority: Priority
  task_time: string | null
  completed_at: string | null
}
type SettingsState = {
  email: string
  timezone: string
  email_enabled: boolean
  push_enabled: boolean
  reminder_minutes: number
}
type Draft = { taskName: string; details: string; priority: Priority; taskTime: string }

const emptyDraft: Draft = { taskName: '', details: '', priority: 'medium', taskTime: '' }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function reminderPreview(value: string) {
  const [h, m] = value.split(':').map(Number)
  const total = (h * 60 + m - 10 + 1440) % 1440
  return prettyTime(`${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`)
}

function prettyTime(value: string | null) {
  if (!value) return ''
  const [h, m] = value.slice(0,5).split(':').map(Number)
  const d = new Date(); d.setHours(h,m,0,0)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)))
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [settings, setSettingsState] = useState<SettingsState | null>(null)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [menuId, setMenuId] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = localDate()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  useEffect(() => {
    let unsubscribe = () => {}
    ;(async () => {
      try { await handleAuthCallback() } catch (e) { console.error(e) }
      setUser(await getUser() as User | null)
      setAuthLoading(false)
      unsubscribe = onAuthChange((_event, currentUser) => setUser(currentUser as User | null))
    })()
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    void refresh()
  }, [user])

  async function refresh() {
    setLoading(true); setError(null)
    try {
      const [{ tasks }, { settings }] = await Promise.all([
        api<{tasks: Task[]}>(`/api/tasks?date=${today}`),
        api<{settings: SettingsState}>('/api/settings'),
      ])
      setTasks(tasks)
      setSettingsState(settings)
      if (settings.timezone === 'UTC' && timezone !== 'UTC') {
        const result = await api<{settings: SettingsState}>('/api/settings', { method: 'PUT', body: JSON.stringify({ timezone, emailEnabled: settings.email_enabled, pushEnabled: settings.push_enabled }) })
        setSettingsState(result.settings)
      }
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  const openTasks = useMemo(() => tasks.filter(t => !t.completed_at), [tasks])
  const completedTasks = useMemo(() => tasks.filter(t => t.completed_at), [tasks])
  const timedTasks = openTasks.filter(t => t.task_time)
  const anytimeTasks = openTasks.filter(t => !t.task_time)
  const completion = tasks.length ? Math.round((completedTasks.length/tasks.length)*100) : 0

  function showMessage(text: string) {
    setMessage(text); window.setTimeout(() => setMessage(null), 2800)
  }

  function openAdd() {
    setEditing(null); setDraft(emptyDraft); setModalOpen(true); setMenuId(null)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setDraft({ taskName: task.task_name, details: task.details || '', priority: task.priority, taskTime: task.task_time?.slice(0,5) || '' })
    setModalOpen(true); setMenuId(null)
  }

  async function saveTask(e: FormEvent) {
    e.preventDefault()
    if (!draft.taskName.trim()) return
    setLoading(true); setError(null)
    try {
      const payload = { ...draft, taskDate: today, timezone }
      if (editing) await api(`/api/tasks/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      else await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) })
      setModalOpen(false); setDraft(emptyDraft); setEditing(null)
      await refresh(); showMessage(editing ? 'Task updated' : 'Task added')
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  async function toggleTask(task: Task) {
    const completing = !task.completed_at
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed_at: completing ? new Date().toISOString() : null } : t))
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ completed: completing }) })
      await refresh()
    } catch (e) { setError((e as Error).message); await refresh() }
  }

  async function deleteTask(task: Task) {
    setMenuId(null)
    if (!window.confirm(`Delete “${task.task_name}”?`)) return
    try { await api(`/api/tasks/${task.id}`, { method: 'DELETE' }); await refresh(); showMessage('Task deleted') }
    catch (e) { setError((e as Error).message) }
  }

  async function saveSettings(patch: Partial<{emailEnabled: boolean; pushEnabled: boolean}>) {
    if (!settings) return
    const result = await api<{settings: SettingsState}>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone, emailEnabled: patch.emailEnabled ?? settings.email_enabled, pushEnabled: patch.pushEnabled ?? settings.push_enabled }),
    })
    setSettingsState(result.settings)
  }

  async function setPush(enabled: boolean) {
    setError(null)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push notifications are not supported in this browser.')
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (enabled) {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') throw new Error('Notification permission was not granted.')
        const { publicKey } = await api<{publicKey: string}>('/api/push')
        if (!publicKey) throw new Error('Web Push is not configured yet. Add the VAPID keys in Netlify.')
        if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
        await api('/api/push', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })
        await saveSettings({ pushEnabled: true })
        showMessage('Push reminders enabled')
      } else {
        if (subscription) {
          await api('/api/push', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) })
          await subscription.unsubscribe()
        }
        await saveSettings({ pushEnabled: false })
        showMessage('Push reminders disabled')
      }
    } catch (e) { setError((e as Error).message) }
  }

  if (authLoading) return <div className="center-screen"><div className="spinner" /></div>

  if (!user) {
    return <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark"><Check size={30} strokeWidth={3}/></div>
        <p className="eyebrow">TO-DO TODAY</p>
        <h1>Keep today<br/>under control.</h1>
        <p className="login-copy">A focused list for what matters today, with reminders 10 minutes before timed tasks.</p>
        <button className="google-button" onClick={() => oauthLogin('google')}>
          <span className="google-g">G</span> Continue with Google
        </button>
        <p className="privacy-copy">We only use your Google account to sign you in. We do not access your Gmail inbox.</p>
      </section>
    </main>
  }

  return <div className="app-shell" onClick={() => menuId && setMenuId(null)}>
    <header className="topbar">
      <div className="brand"><span className="brand-check"><Check size={17} strokeWidth={3}/></span><span>To-do Today</span></div>
      <div className="top-actions">
        <button className="icon-button" aria-label="Settings" onClick={(e) => { e.stopPropagation(); setSettingsOpen(true) }}><Settings size={19}/></button>
        <button className="avatar" title={user.email}>{(user.name || user.email).charAt(0).toUpperCase()}</button>
      </div>
    </header>

    <main className="content">
      <section className="hero-row">
        <div>
          <p className="date-label">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          <h1>Today</h1>
          <p className="summary">{openTasks.length} {openTasks.length === 1 ? 'task' : 'tasks'} left <span>•</span> {completedTasks.length} completed</p>
        </div>
        <button className="add-button desktop-add" onClick={openAdd}><Plus size={18}/> Add task</button>
      </section>

      {tasks.length > 0 && <div className="progress-wrap"><div className="progress-line"><span style={{width: `${completion}%`}}/></div><span>{completion}%</span></div>}
      {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}><X size={16}/></button></div>}

      {loading && tasks.length === 0 ? <div className="task-skeleton"><div/><div/><div/></div> : <>
        {timedTasks.length > 0 && <TaskSection title="Scheduled" tasks={timedTasks} menuId={menuId} setMenuId={setMenuId} toggleTask={toggleTask} openEdit={openEdit} deleteTask={deleteTask}/>} 
        {anytimeTasks.length > 0 && <TaskSection title="Anytime" tasks={anytimeTasks} menuId={menuId} setMenuId={setMenuId} toggleTask={toggleTask} openEdit={openEdit} deleteTask={deleteTask}/>} 
        {openTasks.length === 0 && completedTasks.length === 0 && <div className="empty-state"><div className="empty-check"><Check size={28}/></div><h2>Nothing on your list yet.</h2><p>Add what you need to get done today.</p><button className="add-button" onClick={openAdd}><Plus size={18}/> Add your first task</button></div>}
        {completedTasks.length > 0 && <TaskSection title={`Completed · ${completedTasks.length}`} tasks={completedTasks} completed menuId={menuId} setMenuId={setMenuId} toggleTask={toggleTask} openEdit={openEdit} deleteTask={deleteTask}/>} 
      </>}
    </main>

    <button className="floating-add" onClick={openAdd} aria-label="Add task"><Plus size={25}/></button>

    {modalOpen && <div className="overlay" onMouseDown={() => setModalOpen(false)}>
      <form className="task-modal" onSubmit={saveTask} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">{editing ? 'EDIT TASK' : 'NEW TASK'}</p><h2>{editing ? 'Update task' : 'What needs doing?'}</h2></div><button type="button" className="icon-button" onClick={() => setModalOpen(false)}><X size={20}/></button></div>
        <label className="field"><span>Task name</span><input autoFocus maxLength={140} placeholder="e.g. Call Michael" value={draft.taskName} onChange={e => setDraft({...draft, taskName:e.target.value})}/></label>
        <label className="field"><span>Details <em>Optional</em></span><textarea rows={3} maxLength={1000} placeholder="Add a note, link, or context..." value={draft.details} onChange={e => setDraft({...draft, details:e.target.value})}/></label>
        <div className="field-grid">
          <label className="field"><span><Clock3 size={15}/> Time <em>Optional</em></span><input type="time" value={draft.taskTime} onChange={e => setDraft({...draft, taskTime:e.target.value})}/></label>
          <label className="field"><span>Priority</span><div className="select-wrap"><select value={draft.priority} onChange={e => setDraft({...draft, priority:e.target.value as Priority})}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><ChevronDown size={15}/></div></label>
        </div>
        {draft.taskTime && <div className="reminder-note"><Bell size={16}/><span>Reminder at {reminderPreview(draft.taskTime)} · 10 minutes before</span></div>}
        <button className="save-button" disabled={loading || !draft.taskName.trim()}>{loading ? 'Saving…' : editing ? 'Save changes' : 'Add to today'}</button>
      </form>
    </div>}

    {settingsOpen && settings && <div className="overlay drawer-overlay" onMouseDown={() => setSettingsOpen(false)}>
      <aside className="settings-drawer" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">PREFERENCES</p><h2>Reminders</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)}><X size={20}/></button></div>
        <p className="settings-intro">Timed tasks are reminded <strong>10 minutes before</strong>.</p>
        <SettingToggle icon={<Bell size={19}/>} title="Web Push" description="Get a notification on this device." enabled={settings.push_enabled} onChange={setPush}/>
        <SettingToggle icon={<Mail size={19}/>} title="Email" description={`Send reminders to ${settings.email}`} enabled={settings.email_enabled} onChange={async enabled => { await saveSettings({emailEnabled: enabled}); showMessage(enabled ? 'Email reminders enabled' : 'Email reminders disabled') }}/>
        <div className="settings-meta"><span>Timezone</span><strong>{timezone.replaceAll('_',' ')}</strong></div>
        <div className="settings-meta"><span>Signed in as</span><strong>{user.email}</strong></div>
        <button className="logout-button" onClick={async () => { await logout(); setSettingsOpen(false) }}><LogOut size={17}/> Sign out</button>
      </aside>
    </div>}

    {message && <div className="toast"><Check size={16}/>{message}</div>}
  </div>
}

function TaskSection({title,tasks,completed=false,menuId,setMenuId,toggleTask,openEdit,deleteTask}: {
  title:string; tasks:Task[]; completed?:boolean; menuId:number|null; setMenuId:(id:number|null)=>void;
  toggleTask:(task:Task)=>void; openEdit:(task:Task)=>void; deleteTask:(task:Task)=>void
}) {
  return <section className={`task-section ${completed ? 'completed-section':''}`}>
    <h3>{title}</h3>
    <div className="task-list">
      {tasks.map(task => <article className={`task-row ${task.completed_at?'done':''}`} key={task.id}>
        <button className="check-button" onClick={() => toggleTask(task)} aria-label={task.completed_at?'Mark incomplete':'Complete task'}>{task.completed_at && <Check size={15} strokeWidth={3}/>}</button>
        <div className="task-time">{task.task_time ? prettyTime(task.task_time) : <span>—</span>}</div>
        <div className="task-main"><div className="task-title-line"><span className={`priority-dot ${task.priority}`}/><strong>{task.task_name}</strong></div>{task.details && <p>{task.details}</p>}</div>
        <div className="task-menu-wrap"><button className="more-button" onClick={(e) => {e.stopPropagation(); setMenuId(menuId===task.id?null:task.id)}}><MoreHorizontal size={20}/></button>
          {menuId === task.id && <div className="task-menu" onClick={e=>e.stopPropagation()}><button onClick={()=>openEdit(task)}><Pencil size={15}/> Edit</button><button className="danger" onClick={()=>deleteTask(task)}><Trash2 size={15}/> Delete</button></div>}
        </div>
      </article>)}
    </div>
  </section>
}

function SettingToggle({icon,title,description,enabled,onChange}:{icon:ReactNode;title:string;description:string;enabled:boolean;onChange:(enabled:boolean)=>void|Promise<void>}) {
  return <div className="setting-row"><div className="setting-icon">{icon}</div><div className="setting-copy"><strong>{title}</strong><span>{description}</span></div><button className={`toggle ${enabled?'on':''}`} onClick={()=>onChange(!enabled)} aria-pressed={enabled}><span/></button></div>
}
