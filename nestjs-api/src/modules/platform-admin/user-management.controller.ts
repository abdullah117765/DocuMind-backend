import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePlatformSuperAdmin } from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateManagedUserDto } from './dto/update-managed-user.dto';
import { UserIdDto } from './dto/user-id.dto';
import {
  ManagedUserListResult,
  ManagedUserView,
  UserManagementService,
} from './user-management.service';

interface UsersResult {
  data: ManagedUserListResult;
}

interface UserResult {
  data: {
    user: ManagedUserView;
  };
}

const CSRF_HEADER = {
  name: 'x-csrf-token',
  required: true,
  description: 'Token returned by GET /auth/csrf',
} as const;

@ApiTags('Platform Users')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@RequirePlatformSuperAdmin()
@Controller('users')
export class UserManagementController {
  constructor(private readonly usersService: UserManagementService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List platform users with search and pagination' })
  @ApiOkResponse({ description: 'Platform users' })
  async listUsers(@Query() query: ListUsersQueryDto): Promise<UsersResult> {
    return {
      data: await this.usersService.listUsers(query),
    };
  }

  @Get(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a platform user profile' })
  async getUser(@Param() params: UserIdDto): Promise<UserResult> {
    return {
      data: {
        user: await this.usersService.getUser(params.userId),
      },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: CreateManagedUserDto })
  @ApiOperation({ summary: 'Create a platform user' })
  async createUser(@Body() dto: CreateManagedUserDto): Promise<UserResult> {
    return {
      data: {
        user: await this.usersService.createUser(dto),
      },
    };
  }

  @Patch(':userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: UpdateManagedUserDto })
  @ApiOperation({ summary: 'Update active state for a user' })
  async updateUser(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param() params: UserIdDto,
    @Body() dto: UpdateManagedUserDto,
  ): Promise<UserResult> {
    return {
      data: {
        user: await this.usersService.updateUser(
          principal.userId,
          params.userId,
          dto,
        ),
      },
    };
  }

}
