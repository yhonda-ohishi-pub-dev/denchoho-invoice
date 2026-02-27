const SENDER_ADDRESSES_KEY = 'invoice-sender-addresses'

export function useSettings() {
  const senderAddresses = useState<string[]>('sender-addresses', () => {
    if (import.meta.client) {
      const saved = localStorage.getItem(SENDER_ADDRESSES_KEY)
      return saved ? JSON.parse(saved) : []
    }
    return []
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

  return {
    senderAddresses: readonly(senderAddresses),
    addSenderAddress,
    removeSenderAddress,
  }
}
