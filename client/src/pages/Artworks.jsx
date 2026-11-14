import { useEffect, useState } from 'react';
import { errorText, gql, num } from '../api.js';
import { ArtworkGrid, Banner, Pager } from '../ui.jsx';

const PAGE_SIZE = 20;

export function Artworks({ museums, initialMuseum, onOpen }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [museum, setMuseum] = useState(initialMuseum || '');
  const [department, setDepartment] = useState('');
  const [sort, setSort] = useState('TITLE:ASC');
  const [page, setPage] = useState(1);
  const [departments, setDepartments] = useState([]);
  const [json, setJson] = useState(null);

  useEffect(() => {
    setMuseum(initialMuseum || '');
    setDepartment('');
    setPage(1);
  }, [initialMuseum]);

  useEffect(() => {
    gql(`query Departments($museum: ID) { departments(museum: $museum) { value count } }`, { museum: museum || null })
      .then((result) => setDepartments(result.data?.departments || []));
  }, [museum]);

  useEffect(() => {
    const [field, direction] = sort.split(':');
    gql(`
      query Artworks($filter: ArtworkFilter, $sort: ArtworkSort, $page: PageInput) {
        artworks(filter: $filter, sort: $sort, page: $page) {
          totalCount
          nodes { id title artistName year dateDisplay imageUrl museum { city } }
        }
      }
    `, {
      filter: { search: search || null, museum: museum || null, department: department || null },
      sort: { field, direction },
      page: { page, pageSize: PAGE_SIZE },
    }).then(setJson);
  }, [search, museum, department, sort, page]);

  const connection = json?.data?.artworks;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Коллекция</h1>
          <p>{connection ? `${num(connection.totalCount)} произведений` : ' '}</p>
        </div>
      </div>
      <Banner text={errorText(json)} tone="warn" />
      <form className="filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(draft.trim()); }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Название, художник, техника" />
        <select value={museum} onChange={(event) => { setMuseum(event.target.value); setDepartment(''); setPage(1); }}>
          <option value="">Все музеи</option>
          {museums.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
        <select value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1); }}>
          <option value="">Все отделы</option>
          {departments.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
        </select>
        <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
          <option value="TITLE:ASC">По названию</option>
          <option value="ARTIST:ASC">По художнику</option>
          <option value="YEAR:ASC">Сначала старые</option>
          <option value="YEAR:DESC">Сначала новые</option>
        </select>
        <button type="submit">Найти</button>
      </form>
      <ArtworkGrid nodes={connection?.nodes} onOpen={onOpen} />
      {connection && !connection.nodes.length && <p className="muted">Ничего не найдено.</p>}
      <Pager page={page} total={connection?.totalCount || 0} pageSize={PAGE_SIZE} onPage={setPage} />
    </section>
  );
}
