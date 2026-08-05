import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(payload: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: payload.email.toLowerCase(), isActive: true },
      include: {
        memberships: {
          where: {
            isActive: true,
            company: { isActive: true },
          },
          include: {
            company: true,
          },
          orderBy: [{ createdAt: 'asc' }],
        },
      },
    });

    if (!user || user.memberships.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const activeMembership = user.memberships[0];
    const activeCompany = activeMembership.company;

    const isPasswordValid = await bcrypt.compare(
      payload.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId: user.id,
        companyId: activeCompany.id,
      },
      include: {
        role: {
          include: {
            rolePerms: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const roles = userRoles.map((entry) => entry.role.name);
    const permissions = Array.from(
      new Set(
        userRoles.flatMap((entry) =>
          entry.role.rolePerms.map((rp) => rp.permission.key),
        ),
      ),
    );

    const jwtPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      companyId: activeCompany.id,
      companySlug: activeCompany.slug,
      roles,
      permissions,
    };

    const accessToken = await this.jwtService.signAsync(jwtPayload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      company: {
        id: activeCompany.id,
        name: activeCompany.name,
        slug: activeCompany.slug,
      },
      roles,
      permissions,
    };
  }
}
