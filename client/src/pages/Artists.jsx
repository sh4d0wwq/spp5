import { useEffect, useState } from 'react';
import { errorText, gql, num } from '../api.js';
import { Banner, Pager, lifespan } from '../ui.jsx';

const PAGE_SIZE = 24;

export function Artists({ museums, onOpen }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [nationality, setNationality] = useState('');
  const [museum, setMuseum] = useState('');
  const [sort, setSort] = useState('ARTWORKS:DESC');
  const [page, setPage] = useState(1);
  const [nationalities, setNationalities] = useState([]);
  const [json, setJson] = useState(null);

  useEffect(() => {
    gql(`query { nationalities { value count } }`).then((result) => setNationalities(result.data?.nationalities || []));
  }, []);

  useEffect(() => {
    const [field, direction] = sort.split(':');
    gql(`
      query Artists($filter: ArtistFilter, $sort: ArtistSort, $page: PageInput) {
        artists(filter: $filter, sort: $sort, page: $page) {
          totalCount
          nodes {
            id name nationality birthYear deathYear artworkCount
            artworks(filter: { hasImage: true }, page: { pageSize: 1 }) { nodes { imageUrl } }
          }
        }
      }
    `, {
      filter: { search: search || null, nationality: nationality || null, museum: museum || null },
      sort: { field, direction },
      page: { page, pageSize: PAGE_SIZE },
    }).then(setJson);
  }, [search, nationality, museum, sort, page]);

  const connection = json?.data?.artists;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Художники</h1>
          <p>{connection ? `${num(connection.totalCount)} авторов` : ' '}</p>
        </div>
      </div>
      <Banner text={errorText(json)} tone="warn" />
      <form className="filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(draft.trim()); }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Имя художника" />
        <select value={nationality} onChange={(event) => { setNationality(event.target.value); setPage(1); }}>
          <option value="">Любая страна</option>
          {nationalities.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
        </select>
        <select value={museum} onChange={(event) => { setMuseum(event.target.value); setPage(1); }}>
          <option value="">Все музеи</option>
          {museums.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
        <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
          <option value="ARTWORKS:DESC">Больше работ</option>
          <option value="NAME:ASC">По имени</option>
          <option value="BIRTH:ASC">По году рождения</option>
        </select>
        <button type="submit">Найти</button>
      </form>
      <div className="artists">
        {(connection?.nodes || []).map((artist) => {
          const image = artist.artworks.nodes[0]?.imageUrl;
          return (
            <button key={artist.id} type="button" className="artist" onClick={() => onOpen({ type: 'artist', id: artist.id })}>
              {image ? <img src={image} alt="" loading="lazy" /> : <div className="ph">{artist.name.slice(0, 1)}</div>}
              <div>
                <strong>{artist.name}</strong>
                <span>{[artist.nationality, lifespan(artist)].filter(Boolean).join(', ')}</span>
                <small>{num(artist.artworkCount)} работ</small>
              </div>
            </button>
          );
        })}
      </div>
      {connection && !connection.nodes.length && <p className="muted">Никого не нашли.</p>}
      <Pager page={page} total={connection?.totalCount || 0} pageSize={PAGE_SIZE} onPage={setPage} />
    </section>
  );
}
