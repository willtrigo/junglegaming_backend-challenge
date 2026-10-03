import { Controller, Get } from "@nestjs/common";

@Controller()
export class HelloController {
  @Get()
  hello(): { readonly message: string } {
    return { message: "Hello, World!" };
  }
}
