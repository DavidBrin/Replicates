/** Global search: the `/` dialog and the query grammar it shares with the API. */

export { SearchDialog, type SearchDialogProps } from "./search-dialog";
export {
  compareResults,
  IDENTIFIER_SCORE,
  likePattern,
  MIN_QUERY_LENGTH,
  parseQuery,
  scoreTextMatch,
  type ParsedQuery,
  type SearchGroup,
  type SearchResponse,
  type SearchResult,
  type SearchResultType,
} from "./query";
