declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: TokenClientConfig) => TokenClient
        }
      }
    }
  }
}

interface TokenClientConfig {
  client_id: string
  scope: string
  callback: (response: TokenResponse) => void
  error_callback?: (error: { type: string; message: string }) => void
}

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
  error?: string
}

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly'

export function useGoogleAuth() {
  const accessToken = useState<string | null>('google-access-token', () => null)
  const isLoggedIn = computed(() => !!accessToken.value)
  const tokenExpiry = useState<number>('google-token-expiry', () => 0)

  let tokenClient: TokenClient | null = null

  async function waitForGIS(): Promise<void> {
    if (window.google?.accounts?.oauth2) return

    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(check)
          resolve()
        }
      }, 100)
    })
  }

  function initClient(): TokenClient {
    const config = useRuntimeConfig()
    const clientId = config.public.googleClientId as string

    if (!clientId) {
      throw new Error('Google Client ID が設定されていません。環境変数 NUXT_PUBLIC_GOOGLE_CLIENT_ID を設定してください。')
    }

    return window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response: TokenResponse) => {
        if (response.error) {
          console.error('OAuth error:', response.error)
          return
        }
        accessToken.value = response.access_token
        tokenExpiry.value = Date.now() + response.expires_in * 1000
      },
      error_callback: (error) => {
        console.error('GIS error:', error)
      },
    })
  }

  async function login(): Promise<void> {
    await waitForGIS()
    if (!tokenClient) {
      tokenClient = initClient()
    }
    tokenClient.requestAccessToken({ prompt: 'consent' })
  }

  function logout(): void {
    accessToken.value = null
    tokenExpiry.value = 0
  }

  function isTokenValid(): boolean {
    return !!accessToken.value && Date.now() < tokenExpiry.value
  }

  async function getValidToken(): Promise<string> {
    if (!isTokenValid()) {
      await login()
      // Wait for callback to set the token
      return new Promise((resolve, reject) => {
        const check = setInterval(() => {
          if (accessToken.value) {
            clearInterval(check)
            resolve(accessToken.value)
          }
        }, 100)
        setTimeout(() => {
          clearInterval(check)
          reject(new Error('Token取得がタイムアウトしました'))
        }, 30000)
      })
    }
    return accessToken.value!
  }

  return {
    accessToken: readonly(accessToken),
    isLoggedIn,
    login,
    logout,
    getValidToken,
    isTokenValid,
  }
}
