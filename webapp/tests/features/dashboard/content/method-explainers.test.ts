import { beforeAll, describe, expect, it } from 'vitest'
import type {MethodExplainerContent, MethodId} from '@/features/dashboard/content/method-explainers';
import {
  METHOD_EXPLAINERS,
  
  
  getMethodExplainer
} from '@/features/dashboard/content/method-explainers'

/**
 * All method IDs that should have explainer entries.
 * Update this array when new methods are added to the MethodId union.
 */
const ALL_METHOD_IDS: Array<MethodId> = [
  'loess',
  'moving-average',
  'trend-fit',
  'repeat-sales',
  'empirical-bayes',
  'neighbor-fill',
]

describe('METHOD_EXPLAINERS registry', () => {
  it('has an entry for every MethodId', () => {
    for (const id of ALL_METHOD_IDS) {
      expect(
        METHOD_EXPLAINERS[id],
        `Missing explainer for method "${id}"`,
      ).toBeDefined()
    }
  })

  it('has no extra entries beyond the known MethodIds', () => {
    const registryKeys = Object.keys(METHOD_EXPLAINERS)
    expect(registryKeys.sort()).toEqual([...ALL_METHOD_IDS].sort())
  })

  for (const id of ALL_METHOD_IDS) {
    describe(`"${id}" entry`, () => {
      let content: MethodExplainerContent

      // Safe to assert — the first test ensures all IDs exist
       
      beforeAll(() => {
        content = METHOD_EXPLAINERS[id]!
      })

      it('has a non-empty title', () => {
        expect(content.title.length).toBeGreaterThan(0)
      })

      it('has a non-empty summary', () => {
        expect(content.summary.length).toBeGreaterThan(0)
      })

      it('has at least one benefit', () => {
        expect(content.benefits.length).toBeGreaterThan(0)
        for (const b of content.benefits) {
          expect(b.length).toBeGreaterThan(0)
        }
      })

      it('has at least one caveat', () => {
        expect(content.caveats.length).toBeGreaterThan(0)
        for (const c of content.caveats) {
          expect(c.length).toBeGreaterThan(0)
        }
      })

      it('has non-empty parameter descriptions when parameters exist', () => {
        if (content.parameters) {
          for (const p of content.parameters) {
            expect(p.name.length).toBeGreaterThan(0)
            expect(p.description.length).toBeGreaterThan(0)
          }
        }
      })
    })
  }

  it('has no duplicate titles across methods', () => {
    const titles = Object.values(METHOD_EXPLAINERS).map((e) => e.title)
    const uniqueTitles = new Set(titles)
    expect(uniqueTitles.size).toBe(titles.length)
  })
})

describe('getMethodExplainer', () => {
  it('returns content for a valid method ID', () => {
    const content = getMethodExplainer('loess')
    expect(content).toBeDefined()
    expect(content!.title).toBe('LOESS Smoothing')
  })

  it('returns undefined for an unknown method ID', () => {
    expect(getMethodExplainer('nonexistent-method')).toBeUndefined()
  })
})
