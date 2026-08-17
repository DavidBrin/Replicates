/**
 * Studio's surface.
 *
 * Studio is a different product from the watch app — a different masthead
 * height, a different nav width, and its own named typescale that the main app
 * does not have (R9 §12). Keeping its components behind one barrel is what
 * stops a feed component reaching for `ytcp-*` type, which would be the first
 * step towards the two surfaces looking like one.
 *
 * The pipeline itself is `upload-machine.ts`. It is exported from here because
 * the pages wire it, but nothing in this directory except `upload-dialog.tsx`
 * should be calling it.
 */

export { Claims, type ClaimPolicy, type ClaimsProps } from "./claims";

export {
  DEFAULT_CATEGORY,
  DESCRIPTION_MAX_LENGTH,
  DetailsForm,
  EMPTY_DETAILS,
  TAGS_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  VIDEO_CATEGORIES,
  detailsAreValid,
  parseTags,
  validateDetails,
  type DetailsErrors,
  type DetailsFormProps,
  type VideoDetails,
} from "./details-form";

export {
  STEP_LABELS,
  UPLOAD_STEPS,
  UploadDialog,
  canLeaveStep,
  defaultTitleFor,
  isRunActive,
  type UploadDialogProps,
  type UploadStep,
} from "./upload-dialog";

export {
  Bar,
  UploadProgressView,
  formatBytes,
  type UploadProgressViewProps,
} from "./upload-progress";

export {
  VideoTable,
  type StudioVideoRow,
  type VideoTableProps,
  type VideoTableSort,
} from "./video-table";

export {
  ESTIMATE_MIN_FRACTION,
  IDLE_UPLOAD_STATE,
  PLAYWRIGHT_ONLY,
  UPLOAD_CONCURRENCY,
  browserUploadPorts,
  createUploadRun,
  estimateRemainingSeconds,
  fingerprintFileInBrowser,
  probeSourceInBrowser,
  putBytesWithProgress,
  type ChecksState,
  type ClaimView,
  type CreateVideoInput,
  type EncodeProgress,
  type FinaliseResult,
  type FingerprintPayload,
  type MediaFinaliseInput,
  type ProbedSource,
  type PublishInput,
  type UploadPhase,
  type UploadPorts,
  type UploadProgress,
  type UploadRun,
  type UploadState,
  type UploadTarget,
} from "./upload-machine";
