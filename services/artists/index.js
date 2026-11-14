import { ports } from '../../shared/ports.js';
import { startSubgraph } from '../../shared/server.js';
import {
  artistLoaders,
  artistsHealth,
  initArtists,
  listArtists,
  nationalities,
} from './store.js';

const typeDefs = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])

  input PageInput {
    page: Int = 1
    pageSize: Int = 20
  }

  enum SortDirection {
    ASC
    DESC
  }

  type PageInfo @shareable {
    page: Int!
    pageSize: Int!
    totalPages: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  type Artist @key(fields: "id") {
    id: ID! @shareable
    name: String!
    nationality: String
    birthYear: Int
    deathYear: Int
    museumCodes: [String!]!
    artworkCount: Int!
  }

  input ArtistFilter {
    search: String
    nationality: String
    museum: ID
  }

  enum ArtistSortField {
    NAME
    ARTWORKS
    BIRTH
  }

  input ArtistSort {
    field: ArtistSortField! = ARTWORKS
    direction: SortDirection! = DESC
  }

  type ArtistConnection {
    nodes: [Artist!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }

  type NationalityFacet {
    value: String!
    count: Int!
  }

  type Query {
    artists(filter: ArtistFilter, sort: ArtistSort, page: PageInput): ArtistConnection!
    artist(id: ID!): Artist
    nationalities: [NationalityFacet!]!
  }
`;

initArtists();

const resolvers = {
  Query: {
    artists: (_root, args) => listArtists(args),
    artist: (_root, { id }, ctx) => ctx.loaders.artist.load(id),
    nationalities: () => nationalities(),
  },
  Artist: {
    __resolveReference: (ref, ctx) => ctx.loaders.artist.load(ref.id),
  },
};

await startSubgraph({
  name: 'artists',
  port: ports.artists,
  typeDefs,
  resolvers,
  context: () => ({ loaders: artistLoaders() }),
  health: artistsHealth,
});
