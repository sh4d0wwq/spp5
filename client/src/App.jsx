import { memo, useEffect, useState } from 'react';
import { gql, subscribe } from './api.js';
import { Overview } from './pages/Overview.jsx';
import { Artworks } from './pages/Artworks.jsx';
import { Artists } from './pages/Artists.jsx';
import { Details } from './pages/Details.jsx';

const PAGES = [
  ['overview', 'Главная'],
  ['artworks', 'Коллекция'],
  ['artists', 'Художники'],
];

function storedName() {
  const stored = localStorage.getItem('atlas-user');
  return !stored || stored === 'Студент' ? 'Гость' : stored;
}

const NameField = memo(function NameField({ onChange }) {
  const [value, setValue] = useState(storedName);
  return (
    <label className="user">
      Ваше имя
      <input
        value={value}
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          onChange(next);
        }}
      />
    </label>
  );
});

export function App() {
  const [page, setPage] = useState('overview');
  const [museumFilter, setMuseumFilter] = useState('');
  const [museums, setMuseums] = useState([]);
  const [open, setOpen] = useState(null);
  const [user, setUser] = useState(storedName);
  const [toast, setToast] = useState('');

  useEffect(() => {
    localStorage.setItem('atlas-user', user);
  }, [user]);

  useEffect(() => {
    gql(`query { museums { code name } }`).then((json) => setMuseums(json.data?.museums || []));
  }, []);

  useEffect(() => subscribe(`
    subscription ReviewCreated {
      reviewCreated { authorName rating }
    }
  `, (data) => {
    const review = data?.reviewCreated;
    if (!review) return;
    setToast(`${review.authorName} поставил оценку ${review.rating} из 5`);
    setTimeout(() => setToast(''), 4000);
  }), []);

  function go(id) {
    setPage(id);
    if (id !== 'artworks') setMuseumFilter('');
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>ATLAS</span>
          <small>онлайн-галерея</small>
        </div>
        <nav>
          {PAGES.map(([id, label]) => (
            <button key={id} type="button" className={page === id ? 'active' : ''} onClick={() => go(id)}>
              {label}
            </button>
          ))}
        </nav>
        <NameField onChange={setUser} />
      </aside>
      <main className="main">
        {toast && <div className="toast">{toast}</div>}
        {page === 'overview' && (
          <Overview
            user={user}
            onOpen={setOpen}
            onMuseum={(code) => { setMuseumFilter(code); setPage('artworks'); }}
          />
        )}
        {page === 'artworks' && <Artworks museums={museums} initialMuseum={museumFilter} onOpen={setOpen} />}
        {page === 'artists' && <Artists museums={museums} onOpen={setOpen} />}
      </main>
      <Details open={open} user={user} onOpen={setOpen} onClose={() => setOpen(null)} />
    </div>
  );
}
