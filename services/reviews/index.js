import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { gql } from 'graphql-tag';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { ports } from '../../shared/ports.js';
import { pollIterable } from '../../shared/live.js';
import { startSubgraph } from '../../shared/server.js';
import {
  createReview,
  deleteReview,
  initReviews,
  latestReviewSeq,
  listReviews,
  reviewLoaders,
  reviewsAfter,
  reviewsHealth,
  updateReview,
} from './store.js';

const typeDefs = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])

  input PageInput {
    page: Int = 1
    pageSize: Int = 20
  }

  type PageInfo @shareable {
    page: Int!
    pageSize: Int!
    totalPages: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  type Review {
    id: ID!
    artwork: Artwork!
    authorName: String!
    rating: Int!
    text: String!
    createdAt: String!
  }

  type ReviewSummary {
    count: Int!
    average: Float
  }

  type ReviewConnection {
    nodes: [Review!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }

  type Artwork @key(fields: "id") {
    id: ID! @shareable
    reviews(page: PageInput): ReviewConnection!
    reviewSummary: ReviewSummary!
  }

  input CreateReviewInput {
    artworkId: ID!
    authorName: String!
    rating: Int!
    text: String!
  }

  input UpdateReviewInput {
    id: ID!
    authorName: String!
    rating: Int
    text: String
  }

  type Query {
    reviews(authorName: String, page: PageInput): ReviewConnection!
  }

  type Mutation {
    createReview(input: CreateReviewInput!): Review!
    updateReview(input: UpdateReviewInput!): Review!
    deleteReview(id: ID!, authorName: String!): Boolean!
  }
`;

initReviews();

const resolvers = {
  Query: {
    reviews: (_root, args) => listReviews(args),
  },
  Mutation: {
    createReview: (_root, { input }) => createReview(input),
    updateReview: (_root, { input }) => updateReview(input),
    deleteReview: (_root, args) => deleteReview(args),
  },
  Review: {
    artwork: (review) => ({ id: review.artworkId }),
  },
  Artwork: {
    __resolveReference: (ref) => ({ id: String(ref.id) }),
    reviews: (artwork, args) => listReviews({ artworkId: artwork.id, page: args.page }),
    reviewSummary: (artwork, _args, ctx) => ctx.loaders.summary.load(artwork.id),
  },
};

const { httpServer } = await startSubgraph({
  name: 'reviews',
  port: ports.reviews,
  typeDefs,
  resolvers,
  context: () => ({ loaders: reviewLoaders() }),
  health: reviewsHealth,
});

const liveSchema = buildSubgraphSchema([{
  typeDefs: gql`
    type LiveReview {
      id: ID!
      artworkId: ID!
      authorName: String!
      rating: Int!
      text: String!
      createdAt: String!
    }
    type Query { _live: String }
    type Subscription { reviewCreated: LiveReview! }
  `,
  resolvers: {
    Query: { _live: () => 'ok' },
    Subscription: {
      reviewCreated: {
        subscribe: () => {
          let last = latestReviewSeq();
          return pollIterable(() => {
            const rows = reviewsAfter(last);
            if (rows.length) last = rows[rows.length - 1].seq;
            return rows.map((row) => ({ reviewCreated: row }));
          });
        },
      },
    },
  },
}]);

useServer({ schema: liveSchema }, new WebSocketServer({ server: httpServer, path: '/ws' }));
