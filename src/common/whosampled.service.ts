import { Injectable, NotFoundException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';
import * as cheerio from 'cheerio';

@Injectable()
export class WhoSampledService {
  private readonly logger = new Logger(WhoSampledService.name);
  private baseWsUrl = 'https://www.whosampled.com';
  private flareSolverrUrl: string;

  constructor() {
    this.flareSolverrUrl = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191/v1';
    this.logger.log(`FlareSolverr URL: ${this.flareSolverrUrl}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchHtml(url: string, retries = 3): Promise<string> {
    const fullUrl = url.startsWith('http')
      ? url
      : `${this.baseWsUrl}${url}`;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        this.logger.debug(`Fetching ${fullUrl} (attempt ${attempt + 1}/${retries})`);
        return await this.requestViaFlareSolverr(fullUrl);
      } catch (err) {
        this.logger.warn(`Attempt ${attempt + 1} failed: ${err.message}`);
        if (attempt < retries - 1) {
          await this.delay(2000 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }

    throw new HttpException('Max retries exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }

  private requestViaFlareSolverr(targetUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(this.flareSolverrUrl);
      const postData = JSON.stringify({
        cmd: 'request.get',
        url: targetUrl,
        maxTimeout: 60000,
      });

      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 70000,
      };

      const transport = parsed.protocol === 'https:' ? https : http;

      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.status === 'ok' && json.solution) {
              resolve(json.solution.response);
            } else {
              reject(new HttpException(
                `FlareSolverr error: ${json.message || 'Unknown error'}`,
                HttpStatus.BAD_GATEWAY,
              ));
            }
          } catch {
            reject(new HttpException('Invalid FlareSolverr response', HttpStatus.BAD_GATEWAY));
          }
        });
        res.on('error', reject);
      });

      req.on('error', (err) => {
        reject(new HttpException(`FlareSolverr connection error: ${err.message}`, HttpStatus.BAD_GATEWAY));
      });
      req.setTimeout(70000, () => {
        req.destroy();
        reject(new HttpException('FlareSolverr request timeout', HttpStatus.GATEWAY_TIMEOUT));
      });
      req.write(postData);
      req.end();
    });
  }

  private parseCoversPage(html: string): any[] {
    const $ = cheerio.load(html);
    const results: any[] = [];

    $('section.trackItem').each((_, section) => {
      const el = $(section);
      const trackName = el.find('h3.trackName span[itemprop="name"]').text().trim();
      const trackYear = el.find('h3.trackName .trackYear').text().replace(/[()]/g, '').trim();
      const trackUrl = el.find('h3.trackName a[itemprop="url"]').attr('href') || null;
      const trackImage = el.find('.trackCover img').attr('src') || null;

      el.find('.track-connection').each((_, conn) => {
        const connEl = $(conn);

        connEl.find('li').each((_, li) => {
          const liEl = $(li);
          const coverName = liEl.find('a.connectionName').text().trim();
          const coverUrl = liEl.find('a.connectionName').attr('href') || null;
          const artistLink = liEl.find('a').not('.connectionName').first();
          const coverArtist = artistLink.text().trim();
          const coverArtistUrl = artistLink.attr('href') || null;
          const yearMatch = liEl.text().match(/\((\d{4})\)/);
          const coverYear = yearMatch ? yearMatch[1] : null;

          results.push({
            track: { name: trackName, year: trackYear || null, url: trackUrl, image: trackImage },
            cover: {
              name: coverName,
              artist: coverArtist,
              artistUrl: coverArtistUrl,
              year: coverYear,
              url: coverUrl,
            },
          });
        });
      });
    });

    return results;
  }

  private parsePagination(html: string): { currentPage: number; totalPages: number } {
    const $ = cheerio.load(html);
    const paginationEl = $('.pagination');
    if (!paginationEl.length) return { currentPage: 1, totalPages: 1 };

    const current = parseInt(paginationEl.find('.curr').text().trim(), 10) || 1;
    let maxPage = current;
    paginationEl.find('.page a').each((_, a) => {
      const pageNum = parseInt($(a).text().trim(), 10);
      if (pageNum > maxPage) maxPage = pageNum;
    });

    return { currentPage: current, totalPages: maxPage };
  }

  async getCovers(artistName: string, page = '1'): Promise<any> {
    if (!artistName) throw new Error('No artist name was provided.');

    const url = `${this.baseWsUrl}/${encodeURIComponent(artistName)}/covers/?sp=${page}`;
    const html = await this.fetchHtml(url);
    const covers = this.parseCoversPage(html);
    const pagination = this.parsePagination(html);

    if (!covers.length) {
      throw new NotFoundException(`No covers by ${artistName} found.`);
    }

    return { artist: artistName, type: 'covers_by', pagination, data: covers };
  }

  async getCovered(artistName: string, page = '1'): Promise<any> {
    if (!artistName) throw new Error('No artist name was provided.');

    const url = `${this.baseWsUrl}/${encodeURIComponent(artistName)}/covered/?sp=${page}`;
    const html = await this.fetchHtml(url);
    const covered = this.parseCoversPage(html);
    const pagination = this.parsePagination(html);

    if (!covered.length) {
      throw new NotFoundException(`No covers of ${artistName} found.`);
    }

    return { artist: artistName, type: 'covered_by_others', pagination, data: covered };
  }
}
