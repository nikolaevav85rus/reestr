import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errorMessage';

describe('getErrorMessage', () => {
  it('prefers a string response.data.detail (happy path)', () => {
    const error = { response: { data: { detail: 'Доступ запрещён' } } };
    expect(getErrorMessage(error, 'fallback')).toBe('Доступ запрещён');
  });

  it('joins FastAPI-style validation detail arrays via their msg fields', () => {
    const error = {
      response: {
        data: {
          detail: [
            { msg: 'field required', loc: ['body', 'name'] },
            { msg: 'value too long' },
          ],
        },
      },
    };
    expect(getErrorMessage(error, 'fallback')).toBe('field required; value too long');
  });

  it('falls back to response.data.message then error.message', () => {
    expect(getErrorMessage({ response: { data: { message: 'msg field' } } }, 'fb')).toBe('msg field');
    expect(getErrorMessage({ message: 'runtime error' }, 'fb')).toBe('runtime error');
  });

  it('returns the fallback for empty/whitespace detail and unknown errors (edge)', () => {
    expect(getErrorMessage({ response: { data: { detail: '   ' } } }, 'fb')).toBe('fb');
    expect(getErrorMessage(null, 'fb')).toBe('fb');
    expect(getErrorMessage(undefined, 'fb')).toBe('fb');
    expect(getErrorMessage({}, 'fb')).toBe('fb');
  });

  it('ignores an all-empty validation array and uses the fallback (edge)', () => {
    const error = { response: { data: { detail: [{ foo: 'bar' }, ''] } } };
    expect(getErrorMessage(error, 'fb')).toBe('fb');
  });
});
