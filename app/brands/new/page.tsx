import { BackLink, PageHeader } from "../../components"; import { createBrand } from "../actions"; import { BrandForm } from "../brand-form";
export default function NewBrandPage() { return <><BackLink href="/brands">Brands</BackLink><PageHeader title="Add brand" description="Set up a competitor for monthly tracking."/><BrandForm action={createBrand}/></> }
