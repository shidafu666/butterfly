import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController Entra endpoints', () => {
  function setup() {
    const authService = { login: jest.fn() };
    const auditService = { log: jest.fn() };
    const entraService = {
      isEnabled: jest.fn().mockReturnValue(true),
      buildAuthCodeUrl: jest.fn().mockResolvedValue({
        url: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
        verifier: 'verifier',
        state: 'state',
        nonce: 'nonce',
      }),
      handleCallback: jest.fn(),
    };
    const codeStore = { issue: jest.fn(), consume: jest.fn() };
    const config = new ConfigService({
      ENTRA_REDIRECT_URI: 'https://app.example/api/v1/auth/entra/callback',
      ENTRA_POST_LOGIN_REDIRECT: 'https://app.example/auth/callback',
    });
    const controller = new AuthController(
      authService as never,
      auditService as never,
      entraService as never,
      codeStore as never,
      config,
    );
    return { controller, authService, auditService, entraService, codeStore };
  }

  it('sets a signed secure transaction cookie and rejects unsafe returnTo values', async () => {
    const { controller } = setup();
    const response = { cookie: jest.fn(), redirect: jest.fn() };

    await controller.entraLogin('//evil.example', response as never);

    expect(response.cookie).toHaveBeenCalledWith(
      'butterfly_entra_tx',
      JSON.stringify({ verifier: 'verifier', state: 'state', nonce: 'nonce' }),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        signed: true,
        maxAge: 600_000,
      }),
    );
    expect(response.redirect).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
    );
  });

  it('redirects invalid state without exchanging the provider code', async () => {
    const { controller, entraService } = setup();
    const request = {
      signedCookies: {
        butterfly_entra_tx: JSON.stringify({
          verifier: 'verifier',
          state: 'expected',
          nonce: 'nonce',
        }),
      },
    };
    const response = { clearCookie: jest.fn(), redirect: jest.fn() };

    await controller.entraCallback(
      'code',
      'unexpected',
      undefined,
      request as never,
      response as never,
    );

    expect(response.clearCookie).toHaveBeenCalledWith('butterfly_entra_tx', { path: '/' });
    expect(response.redirect).toHaveBeenCalledWith('https://app.example/login?sso_error=state');
    expect(entraService.handleCallback).not.toHaveBeenCalled();
  });

  it('consumes each exchange code through the single-use store', async () => {
    const { controller, codeStore } = setup();
    const session = { accessToken: 'token', user: { id: 'user-id' } };
    codeStore.consume.mockResolvedValueOnce(session).mockResolvedValueOnce(null);

    await expect(controller.entraExchange({ code: 'one-time' })).resolves.toBe(session);
    await expect(controller.entraExchange({ code: 'one-time' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
