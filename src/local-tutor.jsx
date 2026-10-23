import React, { useEffect, useRef, useState } from 'react';

export default function LocalTutor({ lesson, code }) {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState(''), [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef();
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { controller.current?.abort();setQuestion('');setAnswer('');setError('');setBusy(false); }, [lesson.id]);
  async function ask(event) {
    event.preventDefault();if (!question.trim() || busy) return;
    const current = new AbortController();controller.current = current;
    setBusy(true);setError('');setAnswer('');
    try {
      const response = await fetch('/api/tutor', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: current.signal, body: JSON.stringify({ lessonId: lesson.id, code, question }) });
      const body = await response.json();if (!response.ok) throw Error(body.error || 'The tutor could not respond.');
      setAnswer(body.answer);
    } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    finally { if (controller.current === current) { setBusy(false);controller.current = null; } }
  }
  return <section className="local-tutor">
    <button className="local-tutor-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>Ask the local tutor <span>{open ? '−' : '+'}</span></button>
    {open && <div><p>Ask about this lesson. Your question and current code stay on this server. The model can make mistakes; run the exercise tests to check its suggestions.</p><form onSubmit={ask}><label htmlFor="tutor-question">What feels confusing?</label><textarea id="tutor-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={2000} rows={3} placeholder="Explain this one line…" disabled={busy} /><div className="local-tutor-actions"><button type="submit" disabled={busy || !question.trim()}>{busy ? 'Thinking on this machine…' : 'Get a small hint'}</button>{busy && <button type="button" onClick={() => { controller.current?.abort(); }}>Cancel</button>}</div></form>{error && <p role="alert">{error}</p>}{answer && <div className="local-tutor-answer" role="status">{answer}</div>}</div>}
  </section>;
}
