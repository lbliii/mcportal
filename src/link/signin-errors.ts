/** Safe sign-in diagnostics shared by the browser callback, tools and room. */
import { AppError, type ErrorCode } from '../lib/errors.ts';
import type { Logger } from '../lib/log.ts';

export type SignInStage = 'callback' | 'discovery' | 'registration' | 'authorization' | 'token' | 'account' | 'save' | 'sync';

export interface SignInFailure {
  code: ErrorCode;
  stage: SignInStage;
  reference: string;
  message: string;
}

const UNEXPECTED: Record<SignInStage, string> = {
  callback: 'Could not open the local sign-in listener. Restart MCPortal on this computer and try again.',
  discovery: 'Could not read the hosted server’s sign-in settings. Check the server address and try again.',
  registration: 'Could not register this computer for sign-in. Try again; if it keeps failing, contact the server owner.',
  authorization: 'Could not finish authorization. Start again with a fresh sign-in link on this computer.',
  token: 'Could not finish connecting this computer to your account. Start again with a fresh sign-in link.',
  account: 'Signed in with GitHub, but could not confirm your MCPortal account. Try again; if it keeps failing, contact the server owner.',
  save: 'Could not save sign-in on this computer. Check that the MCPortal data folder is writable and has free disk space, then try again.',
  sync: 'This computer is signed in, but its local portal could not be added to your account. Your local data is still here. Check the connection and ask your agent to retry the import.',
};

/** No exception text, tokens, callback URLs or upstream descriptions enter the log. */
export function signInError(error: unknown, stage: SignInStage, reference: string, log: Logger): AppError {
  const expected = error instanceof AppError;
  const code = expected ? error.code : 'internal';
  const status = expected && typeof error.details?.status === 'number' ? error.details.status : undefined;
  const message = stage === 'save' || stage === 'sync' || !expected ? UNEXPECTED[stage] : error.message;
  log.warn('signin.failed', { reference, stage, code, ...(status !== undefined ? { status } : {}) });
  return new AppError(code, `${message} Reference: ${reference}.`, { details: { stage, reference, ...(status !== undefined ? { status } : {}) } });
}

export function signInFailure(error: AppError): SignInFailure {
  return { code: error.code, stage: error.details!.stage as SignInStage, reference: String(error.details!.reference), message: error.message };
}
