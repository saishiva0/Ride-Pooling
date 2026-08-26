import { describe, expect, it } from 'vitest';
import { mapActiveBlock, mapBlock, mapReport } from './mappers';
import {
  activeBlockDto,
  blockDto,
  ISO_STRING,
  reportDto,
} from '../../tests/fixtures';

describe('mapReport', () => {
  it('maps a report payload to the mobile model', () => {
    const mapped = mapReport(reportDto());
    expect(mapped.id).toBe('report-1');
    expect(mapped.reportedUserId).toBe('user-2');
    expect(mapped.rideId).toBe('ride-1');
    expect(mapped.reason).toBe('HARASSMENT');
    expect(mapped.detail).toBe('was rude at pickup');
    expect(mapped.createdAt).toEqual(new Date(ISO_STRING));
  });

  it('preserves a null rideId/detail', () => {
    const mapped = mapReport(reportDto({ rideId: null, detail: null }));
    expect(mapped.rideId).toBeNull();
    expect(mapped.detail).toBeNull();
  });
});

describe('mapBlock', () => {
  it('maps an active block payload to the mobile model', () => {
    const mapped = mapBlock(blockDto());
    expect(mapped.id).toBe('block-1');
    expect(mapped.blockedUserId).toBe('user-2');
    expect(mapped.createdAt).toEqual(new Date(ISO_STRING));
    expect(mapped.unblockedAt).toBeNull();
  });

  it('parses a non-null unblockedAt', () => {
    const mapped = mapBlock(blockDto({ unblockedAt: ISO_STRING }));
    expect(mapped.unblockedAt).toEqual(new Date(ISO_STRING));
  });
});

describe('mapActiveBlock', () => {
  it('maps a blocks/mine entry to the mobile model', () => {
    const mapped = mapActiveBlock(activeBlockDto());
    expect(mapped.blockedUserId).toBe('user-2');
    expect(mapped.blockedUserName).toBe('Bo');
    expect(mapped.createdAt).toEqual(new Date(ISO_STRING));
  });
});
