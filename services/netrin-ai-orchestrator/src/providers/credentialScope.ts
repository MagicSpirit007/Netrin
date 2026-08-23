export type RequestCredential = {
  getApiKey: () => string
}

export async function withRequestCredential<T>(
  inputApiKey: string,
  operation: (credential: RequestCredential) => Promise<T>
): Promise<T> {
  let scopedKey = inputApiKey
  const credential: RequestCredential = {
    getApiKey: () => scopedKey
  }
  try {
    return await operation(credential)
  } finally {
    scopedKey = ''
  }
}
