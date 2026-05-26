#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
import time

import requests

SESSION_ID = os.environ.get('INSTAGRAM_SESSION_ID', '')
CSRF_TOKEN = os.environ.get('INSTAGRAM_CSRF_TOKEN', '')
WWW_CLAIM = os.environ.get('INSTAGRAM_WWW_CLAIM', '')
DS_USER_ID = os.environ.get('INSTAGRAM_DS_USER_ID', '')

APP_ID = '936619743392459'


def make_session():
    s = requests.Session()
    s.cookies.set('sessionid', SESSION_ID)
    s.cookies.set('csrftoken', CSRF_TOKEN)
    if DS_USER_ID:
        s.cookies.set('ds_user_id', DS_USER_ID)
    s.headers.update({
        'x-csrftoken': CSRF_TOKEN,
        'x-ig-app-id': APP_ID,
        'x-ig-www-claim': WWW_CLAIM,
        'x-requested-with': 'XMLHttpRequest',
        'referer': 'https://www.instagram.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    })
    return s


def fetch_hashtag(session, tag, amount=5):
    url = f'https://www.instagram.com/api/v1/tags/{tag}/sections/'
    data = {'tab': 'recent', 'page': 1, 'next_media_ids': '[]', 'next_page': 1}
    try:
        resp = session.post(url, data=data, timeout=15)
        if resp.status_code != 200:
            raise RuntimeError(f'HTTP {resp.status_code}')
        body = resp.json()
        medias = []
        for section in body.get('sections', []):
            for item in section.get('layout_content', {}).get('medias', []):
                media = item.get('media', {})
                pk = media.get('pk')
                code = media.get('code')
                caption_obj = media.get('caption') or {}
                caption = caption_obj.get('text', '') if isinstance(caption_obj, dict) else ''
                if pk and code and caption:
                    medias.append({'pk': str(pk), 'code': code, 'caption': caption[:500]})
                if len(medias) >= amount:
                    break
            if len(medias) >= amount:
                break
        return medias
    except Exception as e:
        raise RuntimeError(str(e))


def delay():
    time.sleep(random.uniform(3, 7))


def main():
    if not SESSION_ID or not CSRF_TOKEN or not WWW_CLAIM:
        print('[instagram] Missing env vars: INSTAGRAM_SESSION_ID, INSTAGRAM_CSRF_TOKEN, INSTAGRAM_WWW_CLAIM', file=sys.stderr)
        sys.exit(1)

    parser = argparse.ArgumentParser()
    parser.add_argument('--keywords', default='')
    parser.add_argument('--hashtags', default='')
    parser.add_argument('--max', type=int, default=80)
    args = parser.parse_args()

    session = make_session()
    print('[instagram] Using web API with session cookie', file=sys.stderr)

    seen = set()
    results = []

    LIFE_EVENT_HASHTAGS = [
        'justmoved', 'relocated', 'newcity', 'shifting',
        'tripplanning', 'wanderlust', 'vacationplanning', 'bookedtrip',
        'newcar', 'firstcar', 'drivinglicense', 'newdriver',
        'househunting', 'newflat', 'rentingapartment', 'movingday',
        'gettingmarried', 'engaged', 'weddingplanning', 'shaadi',
        'newjob', 'joiningwork', 'relocation', 'officemove',
        'gymmotivation', 'weightlossjourney', 'fitnessmotivation',
        'pregnancyannouncement', 'newborn', 'babyshower',
    ]

    for tag in LIFE_EVENT_HASHTAGS:
        if len(results) >= args.max:
            break
        try:
            medias = fetch_hashtag(session, tag, amount=3)
            added = 0
            for m in medias:
                uid = m['pk']
                if uid not in seen:
                    seen.add(uid)
                    results.append({
                        'id': f'ig_{uid}',
                        'title': '',
                        'selftext': m['caption'],
                        'permalink': f'https://www.instagram.com/p/{m["code"]}/',
                        '_subreddit': 'instagram',
                    })
                    added += 1
            print(f'[instagram] life-event #{tag}: {added} added', file=sys.stderr)
        except Exception as e:
            print(f'[instagram] life-event #{tag} error: {e}', file=sys.stderr)
        delay()

    if args.hashtags:
        hashtags = [h.strip().lstrip('#') for h in args.hashtags.split(',') if h.strip()]
        for tag in hashtags[:15]:
            if len(results) >= args.max:
                break
            try:
                medias = fetch_hashtag(session, tag, amount=5)
                added = 0
                for m in medias:
                    uid = m['pk']
                    if uid not in seen:
                        seen.add(uid)
                        results.append({
                            'id': f'ig_{uid}',
                            'title': '',
                            'selftext': m['caption'],
                            'permalink': f'https://www.instagram.com/p/{m["code"]}/',
                            '_subreddit': 'instagram',
                        })
                        added += 1
                print(f'[instagram] hashtag #{tag}: {added} added', file=sys.stderr)
            except Exception as e:
                print(f'[instagram] hashtag #{tag} error: {e}', file=sys.stderr)
            delay()

    for post in results[:args.max]:
        print(json.dumps(post), flush=True)


if __name__ == '__main__':
    main()
