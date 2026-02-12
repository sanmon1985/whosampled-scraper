import { Injectable } from '@nestjs/common';

import { WhoSampledService } from '../common/whosampled.service';

@Injectable()
export class ArtistsService {
  constructor(private wsService: WhoSampledService) {}

  async getCovers(name: string, page = '1') {
    return await this.wsService.getCovers(name, page);
  }

  async getCovered(name: string, page = '1') {
    return await this.wsService.getCovered(name, page);
  }
}
