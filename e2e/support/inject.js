// A minimal EIP-1193 wallet injected as window.ethereum, standing in for MetaMask in tests.
// It forwards to the local Hardhat node, which signs for its unlocked test accounts, so no
// private key exists anywhere in the browser or this repo. window.__wallet lets a test make
// the "user" reject the next request, exactly as MetaMask's Reject button would (code 4001).
;(() => {
  const RPC = 'http://127.0.0.1:8545'
  const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const listeners = {}
  let connected = false
  window.__wallet = { reject: false, sent: 0 }
  const rpc = async (method, params = []) => {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const j = await r.json()
    if (j.error) {
      const e = new Error(j.error.message)
      e.code = j.error.code
      e.data = j.error.data
      throw e
    }
    return j.result
  }
  const rejected = () => Object.assign(new Error('MetaMask Tx Signature: User denied transaction signature.'), { code: 4001 })
  window.ethereum = {
    isMetaMask: true,
    on: (ev, fn) => ((listeners[ev] ??= []).push(fn)),
    removeListener: (ev, fn) => (listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn)),
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts':
          if (window.__wallet.reject) throw rejected()
          connected = true
          return [USER]
        case 'eth_accounts':
          return connected ? [USER] : []
        case 'eth_chainId':
          return '0x7a69'
        case 'eth_sendTransaction':
          if (window.__wallet.reject) throw rejected()
          window.__wallet.sent++
          return rpc(method, params)
        default:
          return rpc(method, params)
      }
    },
  }
})()
