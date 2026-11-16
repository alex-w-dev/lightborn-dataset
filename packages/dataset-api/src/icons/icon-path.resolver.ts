import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { defaultLocalIconsDir } from './local-icons-paths';

@Injectable()
export class IconPathResolver {
  private readonly iconsPath: string;
  private readonly iconsPathNormalized: string;

  constructor(private readonly configService: ConfigService) {
    const iconsRoot = this.configService.get<string>('ICONS_ROOT');
    if (iconsRoot) {
      const normalizedRoot = path.normalize(iconsRoot);
      this.iconsPath =
        path.basename(normalizedRoot).toLowerCase() === 'all'
          ? normalizedRoot
          : path.join(normalizedRoot, 'All');
    } else {
      this.iconsPath = defaultLocalIconsDir('All');
    }
    this.iconsPathNormalized = path.resolve(this.iconsPath);
  }

  getBasePath(): string {
    return this.iconsPath;
  }

  sanitizeIconName(icon: string): string {
    return path.basename(String(icon ?? '')).replace(/\.png$/i, '');
  }

  toS3SafeIconName(icon: string): string {
    const sanitized = this.sanitizeIconName(icon);
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
      throw new Error('Invalid icon name');
    }
    return sanitized;
  }

  resolvePngPath(icon: string): string {
    const sanitizedIcon = this.sanitizeIconName(icon);
    const filePath = path.resolve(this.iconsPath, `${sanitizedIcon}.png`);
    if (!filePath.startsWith(this.iconsPathNormalized)) {
      throw new Error('Invalid icon path');
    }
    return filePath;
  }
}
