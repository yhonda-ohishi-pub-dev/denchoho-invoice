const SENDER_ADDRESSES_KEY = 'invoice-sender-addresses'
const DRIVE_FOLDER_NAME_KEY = 'invoice-drive-folder-name'
export const DEFAULT_DRIVE_FOLDER_NAME = '電帳法インボイス'

export function useSettings() {
  const senderAddresses = useState<string[]>('sender-addresses', () => {
    if (import.meta.client) {
      const saved = localStorage.getItem(SENDER_ADDRESSES_KEY)
      return saved ? JSON.parse(saved) : []
    }
    return []
  })

  const driveFolderName = useState<string>('drive-folder-name', () => {
    if (import.meta.client) {
      return localStorage.getItem(DRIVE_FOLDER_NAME_KEY) || DEFAULT_DRIVE_FOLDER_NAME
    }
    return DEFAULT_DRIVE_FOLDER_NAME
  })

  function addSenderAddress(address: string): void {
    const trimmed = address.trim().toLowerCase()
    if (!trimmed || senderAddresses.value.includes(trimmed)) return
    senderAddresses.value = [...senderAddresses.value, trimmed]
    localStorage.setItem(SENDER_ADDRESSES_KEY, JSON.stringify(senderAddresses.value))
  }

  function removeSenderAddress(address: string): void {
    senderAddresses.value = senderAddresses.value.filter((a) => a !== address)
    localStorage.setItem(SENDER_ADDRESSES_KEY, JSON.stringify(senderAddresses.value))
  }

  function setDriveFolderName(name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    driveFolderName.value = trimmed
    localStorage.setItem(DRIVE_FOLDER_NAME_KEY, trimmed)
  }

  return {
    senderAddresses: readonly(senderAddresses),
    addSenderAddress,
    removeSenderAddress,
    driveFolderName: readonly(driveFolderName),
    setDriveFolderName,
  }
}
