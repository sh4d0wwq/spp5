import { useEffect, useState } from 'react';
import { errorText, gql, num } from './api.js';

export function Cover({ src, title, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return <div className={`ph ${className}`.trim()}>{title?.slice(0, 1) || '·'}</div>;
  }
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function Banner({ text, tone = 'bad' }) {
  if (!text) return null;
  return <div className={`banner ${tone}`}>{text}</div>;
}

export function Pager({ page, total, pageSize, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
  return (
    <div className="pager">
      <button type="button" className="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Назад</button>
      <span>{page} из {num(pages)}</span>
      <button type="button" className="ghost" disabled={!total || page >= pages} onClick={() => onPage(page + 1)}>Дальше</button>
    </div>
  );
}

export function Drawer({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose}>Закрыть</button>
        </header>
        {children}
      </aside>
    </div>
  );
}

export function ArtworkGrid({ nodes, onOpen }) {
  return (
    <div className="cards">
      {(nodes || []).map((artwork) => (
        <button key={artwork.id} type="button" className="card" onClick={() => onOpen({ type: 'artwork', id: artwork.id })}>
          <Cover src={artwork.imageUrl} title={artwork.title} />
          <strong>{artwork.title}</strong>
          <span>{artwork.artistName || 'Автор неизвестен'}</span>
          <small>{[artwork.dateDisplay || artwork.year, artwork.museum?.city].filter(Boolean).join(' · ')}</small>
        </button>
      ))}
    </div>
  );
}

export function Stars({ value }) {
  return <span className="stars">{'★'.repeat(value)}{'☆'.repeat(5 - value)}</span>;
}

export function ReviewBox({ user, artworkId, summary, reviews, onChanged }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const name = user.trim();

  async function submit(event) {
    event.preventDefault();
    if (!name) {
      setError('Сначала укажите имя слева');
      return;
    }
    setPending(true);
    setError('');
    const json = await gql(`
      mutation CreateReview($input: CreateReviewInput!) {
        createReview(input: $input) { id }
      }
    `, { input: { artworkId, authorName: name, rating, text } });
    setPending(false);
    const message = errorText(json);
    if (message) setError(message);
    else {
      setText('');
      onChanged();
    }
  }

  async function remove(id) {
    const json = await gql(`
      mutation DeleteReview($id: ID!, $authorName: String!) {
        deleteReview(id: $id, authorName: $authorName)
      }
    `, { id, authorName: name });
    const message = errorText(json);
    if (message) setError(message);
    else onChanged();
  }

  return (
    <section className="stack">
      <h3>Отзывы{summary?.count ? ` · ${summary.average} из 5 (${summary.count})` : ''}</h3>
      <ul className="reviews">
        {(reviews || []).map((review) => (
          <li key={review.id}>
            <div className="review-head">
              <strong>{review.authorName}</strong>
              <Stars value={review.rating} />
              {name && review.authorName === name && (
                <button type="button" className="link" onClick={() => remove(review.id)}>удалить</button>
              )}
            </div>
            <p>{review.text}</p>
          </li>
        ))}
        {!reviews?.length && <li className="muted">Отзывов пока нет. Будьте первым.</li>}
      </ul>
      <form className="stack" onSubmit={submit}>
        <div className="rating-pick">
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" className={value <= rating ? 'star on' : 'star'} onClick={() => setRating(value)}>★</button>
          ))}
        </div>
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} placeholder={name ? `Ваш отзыв, ${name}` : 'Сначала укажите имя слева'} required />
        <Banner text={error} />
        <button type="submit" disabled={pending || !name}>{pending ? 'Отправка…' : 'Оставить отзыв'}</button>
      </form>
    </section>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{num(value)}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export function lifespan(artist) {
  if (!artist) return '';
  if (artist.birthYear && artist.deathYear) return `${artist.birthYear}–${artist.deathYear}`;
  if (artist.birthYear) return `род. ${artist.birthYear}`;
  return '';
}
