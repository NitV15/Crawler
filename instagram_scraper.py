#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
import time

from instagrapi import Client

SESSION_FILE = os.path.join(os.path.dirname(__file__), 'instagram_session.json')


def get_client():
    cl = Client()
    username = os.environ.get('INSTAGRAM_USERNAME', '')
    password = os.environ.get('INSTAGRAM_PASSWORD', '')
    if not username or not password:
        raise RuntimeError('INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in .env')

    if os.path.exists(SESSION_FILE):
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)
            return cl
        except Exception as e:
            print(f'[instagram] Session reload failed, re-logging in: {e}', file=sys.stderr)

    cl = Client()
    cl.login(username, password)
    cl.dump_settings(SESSION_FILE)
    print('[instagram] Login successful, session saved', file=sys.stderr)
    return cl


def media_to_post(media):
    caption = (media.caption_text or '')[:500]
    return {
        'id': f'ig_{media.pk}',
        'title': '',
        'selftext': caption,
        'permalink': f'https://www.instagram.com/p/{media.code}/',
        '_subreddit': 'instagram',
    }


def delay():
    time.sleep(random.uniform(5, 10))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--keywords', default='')
    parser.add_argument('--hashtags', default='')
    parser.add_argument('--max', type=int, default=80)
    args = parser.parse_args()

    try:
        cl = get_client()
    except Exception as e:
        print(f'[instagram] Login failed: {e}', file=sys.stderr)
        sys.exit(1)

    seen = set()
    results = []

    # Caption keyword search (indirect leads)
    if args.keywords:
        keywords = [k.strip() for k in args.keywords.split(',') if k.strip()]
        for kw in keywords[:20]:
            if len(results) >= args.max:
                break
            try:
                medias = cl.search_posts(kw, count=5)
                added = 0
                for m in medias:
                    uid = str(m.pk)
                    if uid not in seen and m.caption_text:
                        seen.add(uid)
                        results.append(media_to_post(m))
                        added += 1
                print(f'[instagram] keyword "{kw}": {added} added', file=sys.stderr)
            except Exception as e:
                print(f'[instagram] keyword "{kw}" error: {e}', file=sys.stderr)
            delay()

    # Hashtag search (direct leads)
    if args.hashtags:
        hashtags = [h.strip().lstrip('#') for h in args.hashtags.split(',') if h.strip()]
        for tag in hashtags[:15]:
            if len(results) >= args.max:
                break
            try:
                medias = cl.hashtag_medias_recent(tag, amount=5)
                added = 0
                for m in medias:
                    uid = str(m.pk)
                    if uid not in seen and m.caption_text:
                        seen.add(uid)
                        results.append(media_to_post(m))
                        added += 1
                print(f'[instagram] hashtag #{tag}: {added} added', file=sys.stderr)
            except Exception as e:
                print(f'[instagram] hashtag #{tag} error: {e}', file=sys.stderr)
            delay()

    for post in results[:args.max]:
        print(json.dumps(post), flush=True)


if __name__ == '__main__':
    main()
