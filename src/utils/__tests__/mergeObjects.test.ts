import { describe, it, expect, afterEach } from 'vitest'
import { mergeObjects } from '../general'

describe('mergeObjects', () => {
  afterEach(() => {
    // 防止污染影响其他用例
    delete (Object.prototype as Record<string, unknown>).polluted
  })

  it('递归合并普通对象，数组与标量直接覆盖', () => {
    const merged = mergeObjects(
      { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] } as Record<string, unknown>,
      { nested: { y: 3 }, list: [9], b: 2 } as Record<string, unknown>
    )
    expect(merged).toEqual({ a: 1, nested: { x: 1, y: 3 }, list: [9], b: 2 })
  })

  it('不会通过 __proto__ 污染 Object.prototype', () => {
    const evil = JSON.parse('{"__proto__": {"polluted": "yes"}}')
    mergeObjects({} as Record<string, unknown>, evil)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('不会通过嵌套的 __proto__ / constructor.prototype 污染', () => {
    mergeObjects(
      { cfg: {} } as Record<string, unknown>,
      JSON.parse('{"cfg": {"__proto__": {"polluted": "yes"}}}')
    )
    mergeObjects(
      {} as Record<string, unknown>,
      JSON.parse('{"constructor": {"prototype": {"polluted": "yes"}}}')
    )
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
