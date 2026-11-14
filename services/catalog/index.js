import { ports } from '../../shared/ports.js';
import { startSubgraph } from '../../shared/server.js';
import { MUSEUMS, museumByCode } from '../../shared/museums.js';
import {
  catalogHealth,
  catalogLoaders,
  catalogStats,
  departments,
  getArtwork,
  initCatalog,
  listArtworks,
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

  type Museum {
    code: ID!
    name: String!
    city: String!
    country: String!
    website: String!
    stats: MuseumStats!
    departments: [Facet!]!
    artworks(filter: ArtworkFilter, sort: ArtworkSort, page: PageInput): ArtworkConnection!
  }

  type MuseumStats {
    artworks: Int!
    artists: Int!
    withImages: Int!
    yearMin: Int
    yearMax: Int
  }

  type Artwork @key(fields: "id") {
    id: ID! @shareable
    title: String!
    museum: Museum!
    artist: Artist
    artistName: String
    year: Int
    dateDisplay: String
    medium: String
    culture: String
    department: String
    classification: String
    imageUrl: String
    creditLine: String
    isPublicDomain: Boolean!
    description: String
    sourceUrl: String
  }

  type Artist @key(fields: "id") {
    id: ID! @shareable
    artworks(filter: ArtworkFilter, sort: ArtworkSort, page: PageInput): ArtworkConnection!
  }

  input ArtworkFilter {
    search: String
    museum: ID
    department: String
    artistId: ID
    hasImage: Boolean
    yearFrom: Int
    yearTo: Int
  }

  enum ArtworkSortField {
    TITLE
    YEAR
    ARTIST
    ADDED
  }

  input ArtworkSort {
    field: ArtworkSortField! = TITLE
    direction: SortDirection! = ASC
  }

  type ArtworkConnection {
    nodes: [Artwork!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }

  type Facet {
    value: String!
    count: Int!
  }

  type CatalogStats {
    artworks: Int!
    artists: Int!
    withImages: Int!
  }

  type Query {
    museums: [Museum!]!
    museum(code: ID!): Museum
    artworks(filter: ArtworkFilter, sort: ArtworkSort, page: PageInput): ArtworkConnection!
    artwork(id: ID!): Artwork
    departments(museum: ID): [Facet!]!
    catalogStats: CatalogStats!
  }
`;

initCatalog();

const resolvers = {
  Query: {
    museums: () => MUSEUMS,
    museum: (_root, { code }) => museumByCode(code),
    artworks: (_root, args) => listArtworks(args),
    artwork: (_root, { id }) => getArtwork(id),
    departments: (_root, { museum }) => departments(museum),
    catalogStats: () => catalogStats(),
  },
  Museum: {
    stats: (museum, _args, ctx) => ctx.loaders.museumStats.load(museum.code),
    departments: (museum) => departments(museum.code),
    artworks: (museum, args) => listArtworks({
      ...args,
      filter: { ...(args.filter || {}), museum: museum.code },
    }),
  },
  Artwork: {
    __resolveReference: (ref, ctx) => ctx.loaders.artwork.load(ref.id),
    museum: (artwork) => museumByCode(artwork.museumCode),
    artist: (artwork) => (artwork.artistId ? { id: artwork.artistId } : null),
  },
  Artist: {
    __resolveReference: (ref) => ({ id: ref.id }),
    artworks: (artist, args) => listArtworks({
      ...args,
      filter: { ...(args.filter || {}), artistId: artist.id },
    }),
  },
};

await startSubgraph({
  name: 'catalog',
  port: ports.catalog,
  typeDefs,
  resolvers,
  context: () => ({ loaders: catalogLoaders() }),
  health: catalogHealth,
});
