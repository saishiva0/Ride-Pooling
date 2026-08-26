import { describe, expect, it, vi } from 'vitest';
import { createRequestStore } from './request-store';
import { rideSummary } from '../../tests/fixtures';

describe('createRequestStore', () => {
  it('starts empty', () => {
    const store = createRequestStore();
    expect(store.list()).toEqual([]);
  });

  it('adds a request and returns it in insertion order', () => {
    const store = createRequestStore();
    const first = {
      id: 'request-1',
      rideId: 'ride-1',
      ride: rideSummary({ id: 'ride-1' }),
      requestedSeats: 1,
      status: 'PENDING' as const,
      createdAt: new Date('2026-08-18T10:00:00.000Z'),
    };
    const second = {
      id: 'request-2',
      rideId: 'ride-2',
      ride: rideSummary({ id: 'ride-2' }),
      requestedSeats: 2,
      status: 'PENDING' as const,
      createdAt: new Date('2026-08-18T11:00:00.000Z'),
    };
    store.add(first);
    store.add(second);
    expect(store.list().map((entry) => entry.id)).toEqual([
      'request-1',
      'request-2',
    ]);
  });

  it('notifies listeners on add', () => {
    const store = createRequestStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.add({
      id: 'request-1',
      rideId: 'ride-1',
      ride: rideSummary(),
      requestedSeats: 1,
      status: 'PENDING',
      createdAt: new Date(),
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('updates the status of a stored request and notifies', () => {
    const store = createRequestStore();
    store.add({
      id: 'request-1',
      rideId: 'ride-1',
      ride: rideSummary(),
      requestedSeats: 1,
      status: 'PENDING',
      createdAt: new Date(),
    });
    const listener = vi.fn();
    store.subscribe(listener);
    store.updateStatus('request-1', 'ACCEPTED');
    expect(store.list()[0].status).toBe('ACCEPTED');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes listeners', () => {
    const store = createRequestStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.add({
      id: 'request-1',
      rideId: 'ride-1',
      ride: rideSummary(),
      requestedSeats: 1,
      status: 'PENDING',
      createdAt: new Date(),
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
