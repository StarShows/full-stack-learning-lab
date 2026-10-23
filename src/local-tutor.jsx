import React, { useEffect, useRef, useState } from 'react';

export default function LocalTutor({ lesson, code }) {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(''), [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [history, setHistory] = useState([]), [local, setLocal] = useState(null);
  useEffect(() => { fetch('/api/tutor/status').then(r => r.json()).then(s => setLocal(s.local !== false)).catch(() => {}); }, []);
  const controller = useRef();
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { controller.current?.abort();setQuestion('');setHistory([]);setAnswer('');setError('');setBusy(false); }, [lesson.id]);
  async function ask(event) {
    event.preventDefault();if (!question.trim() || busy) return;
    const current = new AbortController();controller.current = current;
    setBusy(true);setError('');setAnswer('');
    try {
      const response = await fetch('/api/tutor', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: current.signal, body: JSON.stringify({ lessonId: lesson.id, code, question, history }) });
      const body = await response.json();if (!response.ok) throw Error(body.error || 'The tutor could not respond.');
      setAnswer(body.answer);setHistory(h => { const next = [...h, { role: 'user', content: question }, { role: 'assistant', content: body.answer }].slice(-4);while (JSON.stringify(next).length > 24000) next.splice(0, 2);return next; });setQuestion('');
    } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { if (controller.current === current) { setBusy(false);controller.current = null; } }
  }
  return <section className="local-tutor">
    <button className="local-tutor-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>Chat about this lesson <span>{open ? '−' : '+'}</span></button>
    {open && <div><p>Ask about this lesson. {local === true ? 'Your question and current code stay on this server.' : local === false ? 'Your question and code are sent to the server-configured model provider.' : 'Checking the configured model provider…'} The model can make mistakes; run the exercise tests to check its suggestions.</p><div role="log" aria-label="Lesson conversation">{history.map((m, i) => <p key={i}><strong>{m.role === 'user' ? 'You' : 'Tutor'}:</strong> {m.content}</p>)}</div><button type="button" disabled={busy} onClick={() => { setHistory([]);setAnswer(''); }}>Clear conversation</button><form onSubmit={ask}><label htmlFor="tutor-question">What feels confusing?</label><textarea id="tutor-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} rows={3} placeholder="Explain this one line…" disabled={busy} /><div className="local-tutor-actions"><button type="submit" disabled={busy || !question.trim()}>{busy ? 'Thinking…' : 'Send message'}</button>{busy && <button type="button" onClick={() => { controller.current?.abort(); }}>Cancel</button>}</div></form>{error && <p role="alert">{error}</p>}<span role="status" aria-live="polite">{answer ? 'Reply received.' : ''}</span></div>}
  </section>;
}
