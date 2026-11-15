import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_BUSINESS_PROFILES,
  INITIAL_ENSEMBLES,
  INITIAL_EVENTS,
  INITIAL_INDIVIDUAL_PROFILES,
  INITIAL_LISTINGS,
} from '../data/seedData';
import { searchAllEntities } from './globalSearch';

test('searchAllEntities finds matches across all 5 entity categories', () => {
  const res = searchAllEntities({
    listings: INITIAL_LISTINGS,
    artists: INITIAL_INDIVIDUAL_PROFILES,
    ensembles: INITIAL_ENSEMBLES,
    businesses: INITIAL_BUSINESS_PROFILES,
    events: INITIAL_EVENTS,
    query: 'İstanbul',
  });

  assert.equal(res.hasCriteria, true);
  assert.ok(res.counts.listing > 0, 'expected listing matches for İstanbul');
  assert.ok(res.counts.artist > 0, 'expected artist matches for İstanbul');
  assert.ok(res.counts.ensemble > 0, 'expected ensemble matches for İstanbul');
  assert.ok(res.counts.business > 0, 'expected business matches for İstanbul');
  assert.ok(res.counts.event > 0, 'expected event matches for İstanbul');
});

test('searchAllEntities handles Turkish case folding accurately (İ/ı/ş/ç/ö/ü)', () => {
  const firstArtist = INITIAL_INDIVIDUAL_PROFILES[0];
  const queryLower = firstArtist.fullName.toLocaleLowerCase('tr-TR');

  const res = searchAllEntities({
    listings: INITIAL_LISTINGS,
    artists: INITIAL_INDIVIDUAL_PROFILES,
    ensembles: INITIAL_ENSEMBLES,
    businesses: INITIAL_BUSINESS_PROFILES,
    events: INITIAL_EVENTS,
    query: queryLower,
  });

  assert.ok(res.counts.artist >= 1);
  assert.equal(res.grouped.artist[0].id, firstArtist.id);
  assert.equal(res.recommendedCategory, 'artist');
});

test('searchAllEntities finds specific business and ensemble names and sets recommendedCategory', () => {
  const firstBusiness = INITIAL_BUSINESS_PROFILES[0];
  const bizRes = searchAllEntities({
    listings: INITIAL_LISTINGS,
    artists: INITIAL_INDIVIDUAL_PROFILES,
    ensembles: INITIAL_ENSEMBLES,
    businesses: INITIAL_BUSINESS_PROFILES,
    events: INITIAL_EVENTS,
    query: firstBusiness.businessName,
  });
  assert.equal(bizRes.grouped.business[0].id, firstBusiness.id);

  const firstEnsemble = INITIAL_ENSEMBLES[0];
  const ensRes = searchAllEntities({
    listings: INITIAL_LISTINGS,
    artists: INITIAL_INDIVIDUAL_PROFILES,
    ensembles: INITIAL_ENSEMBLES,
    businesses: INITIAL_BUSINESS_PROFILES,
    events: INITIAL_EVENTS,
    query: firstEnsemble.name,
  });
  assert.equal(ensRes.grouped.ensemble[0].id, firstEnsemble.id);
  assert.equal(ensRes.recommendedCategory, 'ensemble');
});

test('searchAllEntities respects city and discipline filters', () => {
  const res = searchAllEntities({
    listings: INITIAL_LISTINGS,
    artists: INITIAL_INDIVIDUAL_PROFILES,
    ensembles: INITIAL_ENSEMBLES,
    businesses: INITIAL_BUSINESS_PROFILES,
    events: INITIAL_EVENTS,
    query: '',
    city: 'İzmir',
    discipline: 'Tümü',
  });

  assert.equal(res.hasCriteria, true);
  for (const hit of res.topHits) {
    assert.equal(hit.city, 'İzmir');
  }
});

test('searchAllEntities finds published events by title', () => {
  const publishedEvent = INITIAL_EVENTS.find((e) => e.status === 'published');
  assert.ok(publishedEvent, 'seed data should contain a published event');

  const res = searchAllEntities({
    listings: INITIAL_LISTINGS,
    artists: INITIAL_INDIVIDUAL_PROFILES,
    ensembles: INITIAL_ENSEMBLES,
    businesses: INITIAL_BUSINESS_PROFILES,
    events: INITIAL_EVENTS,
    query: publishedEvent.title,
  });

  assert.ok(res.counts.event >= 1);
  assert.equal(res.grouped.event[0].id, publishedEvent.id);
});
