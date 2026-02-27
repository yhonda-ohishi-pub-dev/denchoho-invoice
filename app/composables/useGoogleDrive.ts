export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink: string
  webContentLink?: string
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

let cachedFolderId: string | null = null
let cachedFolderName: string | null = null

export function useGoogleDrive() {
  const { getValidToken } = useGoogleAuth()
  const { driveFolderName } = useSettings()

  async function fetchDrive(url: string, options: RequestInit = {}): Promise<any> {
    const token = await getValidToken()
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(`Drive API error: ${res.status} ${error.error?.message || res.statusText}`)
    }
    return res.json()
  }

  async function getOrCreateFolder(): Promise<string> {
    const folderName = driveFolderName.value

    // Clear cache if folder name changed
    if (cachedFolderId && cachedFolderName !== folderName) {
      cachedFolderId = null
      cachedFolderName = null
    }

    if (cachedFolderId) return cachedFolderId

    // Search for existing folder
    const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
    const result = await fetchDrive(searchUrl)

    if (result.files?.length > 0) {
      cachedFolderId = result.files[0].id
      cachedFolderName = folderName
      return cachedFolderId!
    }

    // Create folder
    const folder = await fetchDrive(`${DRIVE_API}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    })

    cachedFolderId = folder.id
    cachedFolderName = folderName
    return cachedFolderId!
  }

  async function uploadFile(
    fileData: string,
    fileName: string,
    mimeType: string,
  ): Promise<DriveFile> {
    const folderId = await getOrCreateFolder()

    const metadata = {
      name: fileName,
      parents: [folderId],
    }

    const boundary = '-------denchoho_boundary'
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${fileData}\r\n` +
      `--${boundary}--`

    const uploadUrl = `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink`

    const token = await getValidToken()
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(`Drive upload error: ${res.status} ${error.error?.message || res.statusText}`)
    }

    return await res.json()
  }

  function getViewUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`
  }

  function getDownloadUrl(fileId: string): string {
    return `https://drive.google.com/uc?export=download&id=${fileId}`
  }

  async function deleteFile(fileId: string): Promise<void> {
    const token = await getValidToken()
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok && res.status !== 404) {
      const error = await res.json().catch(() => ({}))
      throw new Error(`Drive delete error: ${res.status} ${error.error?.message || res.statusText}`)
    }
  }

  return {
    uploadFile,
    getViewUrl,
    getDownloadUrl,
    deleteFile,
  }
}
