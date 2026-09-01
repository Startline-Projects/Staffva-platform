/**
 * Tiny bridge between the test component and the proctor gate wrapping it.
 * EnglishTest learns its server-held attempt id mid-flight; the gate owns
 * the recording session and needs that id when it ends the session. A
 * module singleton avoids threading props through a component that
 * shouldn't know proctoring exists.
 */

type ProctorListener = {
  linkAttempt?: (attemptId: string) => void;
};

let listener: ProctorListener = {};

export function registerProctorListener(l: ProctorListener): () => void {
  listener = l;
  return () => {
    listener = {};
  };
}

export function proctorLinkAttempt(attemptId: string): void {
  listener.linkAttempt?.(attemptId);
}
