const endpoint = process.env.GRAPHQL_URL || 'http://127.0.0.1:4000/graphql';

async function gql(query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  json.httpStatus = response.status;
  return json;
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const stats = await gql(`query {
  catalogStats { artworks artists }
  museums { code stats { artworks } }
  artists(page: { pageSize: 1 }) { totalCount }
}`);
const total = stats.data?.catalogStats?.artworks || 0;
const perMuseum = Object.fromEntries((stats.data?.museums || []).map((museum) => [museum.code, museum.stats.artworks]));
console.log('artworks', total, perMuseum, 'artists', stats.data?.artists?.totalCount);
if (total < 10000) fail(`произведений ${total}, нужно >= 10000`);
if (Object.values(perMuseum).filter((count) => count > 0).length < 3) fail('нужны данные всех трёх музеев');

const nested = await gql(`query {
  museum(code: "AIC") {
    name
    artworks(filter: { search: "monet" }, page: { pageSize: 1 }) {
      totalCount
      nodes {
        title
        artist { name artworks(page: { pageSize: 3 }) { totalCount nodes { title museum { city } } } }
        reviewSummary { count }
      }
    }
  }
}`);
const node = nested.data?.museum?.artworks?.nodes?.[0];
if (!node?.artist?.artworks?.totalCount) fail(`вложенный запрос: ${JSON.stringify(nested.errors || nested.data)}`);
else console.log('nested', node.title, '->', node.artist.name, '->', node.artist.artworks.totalCount, 'works');

const artists = await gql(`query {
  artists(filter: { search: "rembrandt" }, sort: { field: ARTWORKS, direction: DESC }, page: { pageSize: 2 }) {
    totalCount nodes { name museumCodes artworkCount }
  }
}`);
if (!artists.data?.artists?.totalCount) fail(`поиск художников: ${JSON.stringify(artists.errors)}`);
else console.log('artists', artists.data.artists.nodes.map((item) => `${item.name} (${item.museumCodes.join('+')}, ${item.artworkCount})`).join('; '));

const artwork = (await gql(`query { artworks(page: { pageSize: 1 }) { nodes { id } } }`)).data.artworks.nodes[0];
const created = await gql(`mutation($input: CreateReviewInput!) { createReview(input: $input) { id artwork { title } } }`, {
  input: { artworkId: artwork.id, authorName: 'Smoke', rating: 5, text: 'Проверка' },
});
const reviewId = created.data?.createReview?.id;
if (!reviewId) fail(`отзыв не создан: ${JSON.stringify(created.errors)}`);
else {
  const foreign = await gql(`mutation($id: ID!) { deleteReview(id: $id, authorName: "Other") }`, { id: reviewId });
  if (!foreign.errors?.length) fail('чужой отзыв удалился');
  const removed = await gql(`mutation($id: ID!) { deleteReview(id: $id, authorName: "Smoke") }`, { id: reviewId });
  if (!removed.data?.deleteReview) fail('удаление отзыва не сработало');
  else console.log('mutation ok', created.data.createReview.artwork.title);
}

let deep = 'name';
for (let i = 0; i < 4; i += 1) deep = `artist { artworks(page: { pageSize: 1 }) { nodes { title ${deep} } } }`;
const limited = await gql(`query { artworks(page: { pageSize: 1 }) { nodes { title ${deep} } } }`);
const limitedCode = limited.errors?.[0]?.extensions?.code;
if (limited.httpStatus !== 400 && limitedCode !== 'QUERY_TOO_COMPLEX') fail(`ограничитель глубины: ${limited.httpStatus} ${limitedCode}`);
else console.log('depth limit ok');

const obs = await gql(`query { observability { services { name status } } }`);
const names = (obs.data?.observability?.services || []).map((service) => `${service.name}:${service.status}`).join(', ');
if ((names.match(/:ok/g) || []).length < 5) fail(`наблюдаемость: ${names || JSON.stringify(obs.errors)}`);
else console.log('observe', names);

const image = await fetch(endpoint.replace('/graphql', '/media/artworks/') + (await gql(`query {
  museum(code: "AIC") { artworks(filter: { hasImage: true }, page: { pageSize: 1 }) { nodes { id } } }
}`)).data.museum.artworks.nodes[0].id);
if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) fail(`картинка AIC: ${image.status}`);
else console.log('image ok');

if (!process.exitCode) console.log('SMOKE OK');
