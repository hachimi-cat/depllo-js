/** Every failure the SDK reports: an API error (`code` and HTTP `status` from the
 *  envelope), a network or parsing problem, or a webhook that fails verification. */
export class DeplloError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DeplloError';
  }
}
