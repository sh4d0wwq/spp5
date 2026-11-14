import { useEffect, useState } from 'react';
import { errorText, gql, num } from '../api.js';
import { ArtworkGrid, Banner, Cover, Drawer, Pager, ReviewBox, lifespan } from '../ui.jsx';

const ARTWORK = `
  query ArtworkCard($id: ID!) {
    artwork(id: $id) {
      id title artistName dateDisplay year medium culture department classification
      imageUrl creditLine isPublicDomain description sourceUrl
      museum { code name city }
      artist { id name nationality birthYear deathYear artworkCount }
      reviewSummary { count average }
      reviews(page: { page: 1, pageSize: 20 }) { nodes { id authorName rating text createdAt } }
    }
  }
`;

const ARTIST = `
  query ArtistCard($id: ID!, $page: PageInput) {
    artist(id: $id) {
      id name nationality birthYear deathYear artworkCount museumCodes
      artworks(sort: { field: YEAR, direction: ASC }, page: $page) {
        totalCount
        nodes { id title artistName year dateDisplay imageUrl museum { city } }
      }
    }
  }
`;

export function Details({ open, user, onOpen, onClose }) {
  if (!open) return null;
  if (open.type === 'artist') return <ArtistDrawer id={open.id} onOpen={onOpen} onClose={onClose} />;
  return <ArtworkDrawer id={open.id} user={user} onOpen={onOpen} onClose={onClose} />;
}

function ArtworkDrawer({ id, user, onOpen, onClose }) {
  const [json, setJson] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    gql(ARTWORK, { id }).then(setJson);
  }, [id, version]);

  const artwork = json?.data?.artwork;
  return (
    <Drawer title={artwork?.title || 'Произведение'} onClose={onClose}>
      {!artwork && <p className="muted">{errorText(json) || 'Загрузка…'}</p>}
      {artwork && (
        <div className="stack">
          <Banner text={errorText(json)} tone="warn" />
          <Cover className="hero" src={artwork.imageUrl} title={artwork.title} />
          {artwork.artist
            ? (
              <button type="button" className="artist-link" onClick={() => onOpen({ type: 'artist', id: artwork.artist.id })}>
                <strong>{artwork.artist.name}</strong>
                <span>{[artwork.artist.nationality, lifespan(artwork.artist)].filter(Boolean).join(', ')}</span>
                <small>{num(artwork.artist.artworkCount)} работ в каталоге →</small>
              </button>
            )
            : <p className="muted">{artwork.artistName || 'Автор неизвестен'}</p>}
          <dl className="facts">
            <Fact label="Дата" value={artwork.dateDisplay || artwork.year} />
            <Fact label="Техника" value={artwork.medium} />
            <Fact label="Происхождение" value={artwork.culture} />
            <Fact label="Отдел" value={artwork.department} />
            <Fact label="Музей" value={`${artwork.museum.name}, ${artwork.museum.city}`} />
          </dl>
          {artwork.description && <p className="description">{artwork.description}</p>}
          {artwork.sourceUrl && <a className="source" href={artwork.sourceUrl} target="_blank" rel="noreferrer">Страница на сайте музея</a>}
          <ReviewBox
            user={user}
            artworkId={artwork.id}
            summary={artwork.reviewSummary}
            reviews={artwork.reviews.nodes}
            onChanged={() => setVersion((value) => value + 1)}
          />
        </div>
      )}
    </Drawer>
  );
}

function ArtistDrawer({ id, onOpen, onClose }) {
  const [page, setPage] = useState(1);
  const [json, setJson] = useState(null);

  useEffect(() => setPage(1), [id]);
  useEffect(() => {
    gql(ARTIST, { id, page: { page, pageSize: 8 } }).then(setJson);
  }, [id, page]);

  const artist = json?.data?.artist;
  return (
    <Drawer title={artist?.name || 'Художник'} onClose={onClose}>
      {!artist && <p className="muted">{errorText(json) || 'Загрузка…'}</p>}
      {artist && (
        <div className="stack">
          <p className="muted">{[artist.nationality, lifespan(artist)].filter(Boolean).join(', ') || 'Биография не указана'}</p>
          <p>{num(artist.artworkCount)} работ · {artist.museumCodes.length > 1 ? `${artist.museumCodes.length} музея` : '1 музей'}</p>
          <ArtworkGrid nodes={artist.artworks.nodes} onOpen={onOpen} />
          <Pager page={page} total={artist.artworks.totalCount} pageSize={8} onPage={setPage} />
        </div>
      )}
    </Drawer>
  );
}

function Fact({ label, value }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
