import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { OpenlistInfo } from '../type/openlist/openlistInfo'

interface OpenlistState {
  markInRclone: string
  endpoint: OpenlistInfo['endpoint']
  openlistConfig: OpenlistInfo['openlistConfig']
  version: OpenlistInfo['version']
  process: OpenlistInfo['process']
}

interface OpenlistActions {
  setMarkInRclone: (mark: string) => void
  setEndpoint: (endpoint: OpenlistInfo['endpoint']) => void
  updateEndpoint: (partial: Partial<OpenlistInfo['endpoint']>) => void
  setOpenlistConfig: (config: OpenlistInfo['openlistConfig']) => void
  updateOpenlistConfig: (partial: Partial<OpenlistInfo['openlistConfig']>) => void
  setVersion: (version: OpenlistInfo['version']) => void
  setProcess: (process: OpenlistInfo['process']) => void
  updateProcess: (partial: Partial<OpenlistInfo['process']>) => void
  reset: () => void
}

export type OpenlistStore = OpenlistState & OpenlistActions

const createDefaultState = (): OpenlistState => ({
  markInRclone: '.netmount-openlist.',
  endpoint: {
    url: '',
    isLocal: true,
    auth: {
      token: '',
    },
  },
  openlistConfig: {
    force: true,
    scheme: {
      // 只监听本机：应用仅通过回环地址访问，避免把管理界面和 WebDAV 暴露给局域网
      address: '127.0.0.1',
      http_port: 9751,
    },
    temp_dir: 'data\\temp',
    site_url: '',
    cdn: '',
    jwt_secret: '',
    token_expires_in: 48,
    database: {
      type: 'sqlite3',
      host: '',
      port: 0,
      user: '',
      password: '',
      name: '',
      db_file: 'data/data.db',
      table_prefix: 'x_',
      ssl_mode: '',
    },
    bleve_dir: 'bleve',
    log: {
      enable: true,
      name: 'log/log.log',
      max_size: 50,
      max_backups: 30,
      max_age: 28,
      compress: false,
      filter: {
        enable: true,
        filters: [
          { cidr: '', path: '/ping', method: '' },
          { cidr: '', path: '', method: 'HEAD' },
        ],
      },
    },
    tasks: {
      download: { workers: 5, max_retry: 1, expire_seconds: 0 },
      transfer: { workers: 5, max_retry: 2, expire_seconds: 0 },
      upload: { workers: 5, max_retry: 0, expire_seconds: 0 },
      copy: { workers: 5, max_retry: 2, expire_seconds: 0 },
    },
    cors: {
      allow_origins: ['*'],
      allow_methods: ['*'],
      allow_headers: ['*'],
    },
  },
  version: {
    version: '',
  },
  process: {},
})

export const useOpenlistStore = create<OpenlistStore>()(
  immer((set) => ({
    ...createDefaultState(),

    setMarkInRclone: (mark) => {
      set((state) => {
        state.markInRclone = mark
      })
    },

    setEndpoint: (endpoint) => {
      set((state) => {
        state.endpoint = endpoint
      })
    },

    updateEndpoint: (partial) => {
      set((state) => {
        Object.assign(state.endpoint, partial)
      })
    },

    setOpenlistConfig: (config) => {
      set((state) => {
        state.openlistConfig = config
      })
    },

    updateOpenlistConfig: (partial) => {
      set((state) => {
        Object.assign(state.openlistConfig, partial)
      })
    },

    setVersion: (version) => {
      set((state) => {
        state.version = version
      })
    },

    setProcess: (process) => {
      set((state) => {
        state.process = process
      })
    },

    updateProcess: (partial) => {
      set((state) => {
        Object.assign(state.process, partial)
      })
    },

    reset: () => {
      set(createDefaultState())
    },
  }))
)
