import { Controller, Get, Param, Query } from '@nestjs/common';

import { ArtistsService } from './artists.service';

@Controller('artist')
export class ArtistsController {
  constructor(private artService: ArtistsService) {}

  @Get(':name/covers')
  async getCovers(
    @Param('name') name: string,
    @Query('page') page = '1',
  ) {
    return await this.artService.getCovers(name, page);
  }

  @Get(':name/covered')
  async getCovered(
    @Param('name') name: string,
    @Query('page') page = '1',
  ) {
    return await this.artService.getCovered(name, page);
  }
}
