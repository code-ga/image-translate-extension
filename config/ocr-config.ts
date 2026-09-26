export const OCR_BATCH_SIZE = 6;

/**
 * Number of images whose PaddleOCR pipeline may run at the same time. The
 * detection and recognition ORT sessions are shared, and concurrent
 * `session.run()` calls on one WebGPU/WASM session is what crashes the
 * extension process, so this stays at 1.
 */
export const OCR_CONCURRENCY = 1;

/** Only the N largest images of a page are OCR'd up front. */
export const MAX_OCR_IMAGES_PER_PAGE = 5;

/** Images/canvases smaller than this in either dimension are ignored. */
export const OCR_MIN_SIDE_PX = 30;
