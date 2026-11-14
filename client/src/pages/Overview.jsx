import { useEffect, useState } from 'react';
import { errorText, gql, num } from '../api.js';
import { ArtworkGrid, Banner, Stars } from '../ui.jsx';

const QUERY = `
  query Home($user: String) {
    catalogStats { artworks artists withImages }
    museums {
      code name city country
      stats { artworks artists yearMin yearMax }
      artworks(filter: { hasImage: true }, sort: { field: YEAR, direction: DESC }, page: { pageSize: 1 }) {
        nodes { imageUrl }
      }
    }
    highlights: artworks(filter: { hasImage: true, search: "oil canvas", department: "Painting and Sculpture of Europe" }, sort: { field: YEAR, direction: DESC }, page: { page: 2, pageSize: 8 }) {
      nodes { id title artistName year dateDisplay imageUrl museum { city } }
    }
    latest: reviews(page: { pageSize: 6 }) {
      nodes { id authorName rating text artwork { id title imageUrl } }
    }
    mine: reviews(authorName: $user, page: { pageSize: 6 }) {
      totalCount
      nodes { id rating text artwork { id title imageUrl } }
    }
  }
`;

export function Overview({ user, onOpen, onMuseum }) {
  const [json, setJson] = useState(null);
  const name = user.trim();

  useEffect(() => {
    const load = () => gql(QUERY, { user: name }).then(setJson);
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [name]);

  const data = json?.data;

  return (
    <section className="page">
      <div className="hero-head">
        <h1>Три музея — одна коллекция</h1>
        <p>
          {data
            ? `${num(data.catalogStats.artworks)} произведений и ${num(data.catalogStats.artists)} художников из Чикаго, Кливленда и Копенгагена.`
            : 'Загрузка…'}
        </p>
      </div>
      <Banner text={errorText(json)} tone="warn" />
      <div className="museums">
        {(data?.museums || []).map((museum) => (
          <button key={museum.code} type="button" className="museum" onClick={() => onMuseum(museum.code)}>
            {museum.artworks.nodes[0]?.imageUrl && <img src={museum.artworks.nodes[0].imageUrl} alt="" />}
            <div className="museum-body">
              <strong>{museum.name}</strong>
              <span>{museum.city}, {museum.country}</span>
              <small>{num(museum.stats.artworks)} работ · {num(museum.stats.artists)} художников</small>
            </div>
          </button>
        ))}
      </div>
      {!!data?.highlights?.nodes?.length && (
        <>
          <h2 className="section">Европейская живопись</h2>
          <ArtworkGrid nodes={data.highlights.nodes} onOpen={onOpen} />
        </>
      )}
      <div className="split">
        <article className="panel">
          <h2>Свежие отзывы</h2>
          <ReviewList reviews={data?.latest?.nodes} onOpen={onOpen} showAuthor />
        </article>
        <article className="panel">
          <h2>Мои отзывы{name && data?.mine?.totalCount ? ` · ${data.mine.totalCount}` : ''}</h2>
          {name
            ? <ReviewList reviews={data?.mine?.nodes} onOpen={onOpen} empty="Вы ещё ничего не оценили." />
            : <p className="muted">Введите имя слева — здесь будут только ваши отзывы.</p>}
        </article>
      </div>
    </section>
  );
}

function ReviewList({ reviews, onOpen, showAuthor, empty = 'Отзывов пока нет.' }) {
  if (!reviews?.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="review-list">
      {reviews.map((review) => (
        <li key={review.id}>
          <button type="button" onClick={() => onOpen({ type: 'artwork', id: review.artwork.id })}>
            {review.artwork.imageUrl ? <img src={review.artwork.imageUrl} alt="" loading="lazy" /> : <div className="ph">·</div>}
            <div>
              <strong>{review.artwork.title}</strong>
              <span>{showAuthor && `${review.authorName} · `}<Stars value={review.rating} /></span>
              <small>{review.text}</small>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
